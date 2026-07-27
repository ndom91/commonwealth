import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { createServerFn } from '@tanstack/react-start';
import { provisioning } from './auth.js';
import { requireMember } from './authorize.js';
import { client } from './db.js';
import { PAGE_SIZE } from './knowledge.js';
import { isRole, type Role } from './roles.js';

/* Checked before the value reaches a `::uuid` cast, so a malformed id comes
   back as a sentence rather than a Postgres syntax error. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type IdentityInput = { name: string; role: Role; keyLabel: string };
type IdentityAmendment = {
  name: string;
  role: Role;
  description: string | null;
  autoApprove: boolean;
};

/* Everything in this module manages who may act — agent credentials and the
   people who hold accounts — so it is uniformly behind `admin`. The one
   exception is redeeming an invitation, where the token is the authorisation
   and there is no session yet. */
async function adminId(): Promise<string> {
  const { userId } = await requireMember('admin');
  return userId;
}

/* Keyset paginated on (created_at DESC, id DESC), the same ordering the source
   register and the event log use.
 *
 * Unlike those two, this one cannot simply cap and tell you to narrow with a
 * filter: there are no filters here, and an unreachable holder is a credential
 * you cannot revoke. So the page is bounded and a cursor walks the rest.
 *
 * Bounding matters more than the row count suggests — each row carries a
 * json_agg of every credential that holder has ever owned, so the payload grows
 * with key churn, not just with headcount. */
export const listIdentities = createServerFn({ method: 'GET' })
  .validator((value: unknown): { cursor: { createdAt: string; id: string } | null } => {
    const input = (value ?? {}) as { cursor?: { createdAt?: string; id?: string } };
    if (!input.cursor) return { cursor: null };
    if (!input.cursor.createdAt || !input.cursor.id) throw new Error('Invalid cursor');
    return { cursor: { createdAt: input.cursor.createdAt, id: input.cursor.id } };
  })
  .handler(async ({ data }) => {
    await adminId();
    const rows = await client`
      SELECT users.id, users.display_name AS name, users.role, users.created_at, users.description,
        users.disabled_at, users.auto_approve,
        COALESCE(json_agg(json_build_object('id', api_keys.id, 'prefix', api_keys.key_prefix, 'label', managed_api_key.label, 'createdAt', api_keys.created_at, 'lastUsedAt', api_keys.last_used_at, 'revokedAt', api_keys.revoked_at)
          ORDER BY api_keys.created_at DESC) FILTER (WHERE api_keys.id IS NOT NULL), '[]') AS keys
      FROM users
      LEFT JOIN api_keys ON api_keys.user_id = users.id
      LEFT JOIN managed_api_key ON managed_api_key.id = api_keys.id
      WHERE (
        ${data.cursor?.createdAt ?? null}::timestamptz IS NULL
        OR (users.created_at, users.id)
           < (${data.cursor?.createdAt ?? null}::timestamptz, ${data.cursor?.id ?? null}::uuid)
      )
      GROUP BY users.id
      ORDER BY users.created_at DESC, users.id DESC
      LIMIT ${PAGE_SIZE + 1}
    `;
    /* One row past the page proves another page exists without counting the
       whole table. */
    const hasMore = rows.length > PAGE_SIZE;
    return { identities: rows.slice(0, PAGE_SIZE), hasMore };
  });

export const createIdentity = createServerFn({ method: 'POST' })
  .validator((value: unknown): IdentityInput => {
    const input = value as Partial<IdentityInput>;
    if (
      !input.name?.trim() ||
      !input.keyLabel?.trim() ||
      !['reader', 'writer', 'reviewer', 'admin'].includes(input.role ?? '')
    )
      throw new Error('Invalid identity details');
    return {
      name: input.name.trim(),
      keyLabel: input.keyLabel.trim(),
      role: input.role as IdentityInput['role'],
    };
  })
  .handler(async ({ data }) => {
    const createdByAdminId = await adminId();
    const secret = `tkb_${randomBytes(32).toString('base64url')}`;
    const salt = randomBytes(16).toString('hex');
    const secretHash = `${salt}:${scryptSync(secret, salt, 32).toString('hex')}`;
    const keyId = randomUUID();
    let identityId: string | undefined;
    await client.begin(async (transaction) => {
      const [identity] = await transaction<{ id: string }[]>`
        INSERT INTO users (workspace_id, display_name, role)
        SELECT id, ${data.name}, ${data.role} FROM workspaces WHERE name = 'default'
        RETURNING id
      `;
      if (!identity) throw new Error('Default workspace is unavailable');
      identityId = identity.id;
      await transaction`
        INSERT INTO api_keys (id, user_id, key_prefix, secret_hash)
        VALUES (${keyId}, ${identity.id}, ${secret.slice(0, 12)}, ${secretHash})
      `;
      await transaction`
        INSERT INTO managed_api_key (id, knowledge_user_id, label, created_by_admin_id)
        VALUES (${keyId}, ${identity.id}, ${data.keyLabel}, ${createdByAdminId})
      `;
      await transaction`
        INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
        SELECT id, ${createdByAdminId}, 'api_key_created',
          ${JSON.stringify({ identityId: identity.id, keyId, label: data.keyLabel })}::jsonb
        FROM workspaces WHERE name = 'default'
      `;
    });
    if (!identityId) throw new Error('Unable to create identity');
    return { identityId, key: secret, prefix: secret.slice(0, 12) };
  });

/* Amend a holder's record. Role changes alter what every credential this
   holder owns is permitted to do, so the change is written to the event log
   alongside the values it replaced. */
export const updateIdentity = createServerFn({ method: 'POST' })
  .validator((value: unknown): { identityId: string } & IdentityAmendment => {
    const input = value as Partial<{
      identityId: string;
      name: string;
      role: string;
      description: string;
      autoApprove: boolean;
    }>;
    if (!input.identityId?.trim()) throw new Error('Invalid identity');
    if (!input.name?.trim()) throw new Error('A holder name is required');
    if (!['reader', 'writer', 'reviewer', 'admin'].includes(input.role ?? ''))
      throw new Error('Invalid role');
    if (typeof input.autoApprove !== 'boolean') throw new Error('Invalid trusted-holder setting');
    return {
      identityId: input.identityId.trim(),
      name: input.name.trim(),
      role: input.role as IdentityAmendment['role'],
      description: input.description?.trim() || null,
      autoApprove: input.autoApprove,
    };
  })
  .handler(async ({ data }) => {
    const administrator = await adminId();
    await client.begin(async (transaction) => {
      const [before] = await transaction<
        {
          workspace_id: string;
          display_name: string;
          role: string;
          description: string | null;
          auto_approve: boolean;
        }[]
      >`
        SELECT workspace_id, display_name, role, description, auto_approve
        FROM users WHERE id = ${data.identityId}
      `;
      if (!before) throw new Error('That identity no longer exists');
      await transaction`
        UPDATE users
        SET display_name = ${data.name}, role = ${data.role}, description = ${data.description},
            auto_approve = ${data.autoApprove}
        WHERE id = ${data.identityId}
      `;
      /* Values are narrowed to what jsonb can carry rather than `unknown`, so
         the compiler — not a runtime surprise — catches a field that cannot be
         written to the event log. */
      const changed: Record<
        string,
        { from: string | boolean | null; to: string | boolean | null }
      > = {};
      if (before.display_name !== data.name)
        changed.name = { from: before.display_name, to: data.name };
      if (before.role !== data.role) changed.role = { from: before.role, to: data.role };
      if ((before.description ?? null) !== data.description)
        changed.description = { from: before.description, to: data.description };
      /* Trusting a holder delegates review authority to an agent, so the change
         is recorded as deliberately as a role change. */
      if (before.auto_approve !== data.autoApprove)
        changed.autoApprove = { from: before.auto_approve, to: data.autoApprove };
      if (Object.keys(changed).length > 0) {
        await transaction`
          INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
          VALUES (${before.workspace_id}, ${administrator}, 'identity_amended',
            ${JSON.stringify({ identityId: data.identityId, changed })}::jsonb)
        `;
      }
    });
    return { identityId: data.identityId };
  });

/* Suspend or restore a holder in one move. AccessService only authenticates
   keys whose holder has `disabled_at IS NULL`, so disabling blocks every
   credential this holder owns at the MCP boundary immediately — and, unlike
   revoking, it is reversible and destroys nothing. */
export const setIdentityDisabled = createServerFn({ method: 'POST' })
  .validator((value: unknown): { identityId: string; disabled: boolean } => {
    const input = value as Partial<{ identityId: string; disabled: boolean }>;
    if (!input.identityId?.trim()) throw new Error('Invalid identity');
    if (typeof input.disabled !== 'boolean') throw new Error('Invalid state');
    return { identityId: input.identityId.trim(), disabled: input.disabled };
  })
  .handler(async ({ data }) => {
    const administrator = await adminId();
    await client.begin(async (transaction) => {
      const [identity] = await transaction<{ workspace_id: string; disabled_at: string | null }[]>`
        SELECT workspace_id, disabled_at FROM users WHERE id = ${data.identityId}
      `;
      if (!identity) throw new Error('That identity no longer exists');
      if (data.disabled === Boolean(identity.disabled_at)) return;
      /* Branch rather than interpolating a `now()` fragment: a fragment built
         from the pooled client is not the transaction's handle, and the write
         silently produced no timestamp. */
      if (data.disabled) {
        await transaction`UPDATE users SET disabled_at = now() WHERE id = ${data.identityId}`;
      } else {
        await transaction`UPDATE users SET disabled_at = NULL WHERE id = ${data.identityId}`;
      }
      await transaction`
        INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
        VALUES (${identity.workspace_id}, ${administrator},
          ${data.disabled ? 'identity_disabled' : 'identity_enabled'},
          ${JSON.stringify({ identityId: data.identityId })}::jsonb)
      `;
    });
    return { identityId: data.identityId, disabled: data.disabled };
  });

/* Issue an additional credential to an existing holder. Rotation is a normal
   custody operation: a holder outlives any one credential, so voiding a key
   must never strand the identity that held it. */
export const issueCredential = createServerFn({ method: 'POST' })
  .validator((value: unknown): { identityId: string; keyLabel: string } => {
    const input = value as Partial<{ identityId: string; keyLabel: string }>;
    if (!input.identityId?.trim() || !input.keyLabel?.trim())
      throw new Error('Invalid credential details');
    return { identityId: input.identityId.trim(), keyLabel: input.keyLabel.trim() };
  })
  .handler(async ({ data }) => {
    const createdByAdminId = await adminId();
    const secret = `tkb_${randomBytes(32).toString('base64url')}`;
    const salt = randomBytes(16).toString('hex');
    const secretHash = `${salt}:${scryptSync(secret, salt, 32).toString('hex')}`;
    const keyId = randomUUID();
    await client.begin(async (transaction) => {
      const [identity] = await transaction<{ id: string; workspace_id: string }[]>`
        SELECT id, workspace_id FROM users WHERE id = ${data.identityId}
      `;
      if (!identity) throw new Error('That identity no longer exists');
      await transaction`
        INSERT INTO api_keys (id, user_id, key_prefix, secret_hash)
        VALUES (${keyId}, ${identity.id}, ${secret.slice(0, 12)}, ${secretHash})
      `;
      await transaction`
        INSERT INTO managed_api_key (id, knowledge_user_id, label, created_by_admin_id)
        VALUES (${keyId}, ${identity.id}, ${data.keyLabel}, ${createdByAdminId})
      `;
      await transaction`
        INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
        VALUES (${identity.workspace_id}, ${createdByAdminId}, 'api_key_created',
          ${JSON.stringify({ identityId: identity.id, keyId, label: data.keyLabel })}::jsonb)
      `;
    });
    return { identityId: data.identityId, key: secret, prefix: secret.slice(0, 12) };
  });

export const revokeKey = createServerFn({ method: 'POST' })
  .validator((value: unknown): { keyId: string } => {
    const keyId = (value as { keyId?: string }).keyId;
    if (!keyId) throw new Error('Invalid key');
    return { keyId };
  })
  .handler(async ({ data }) => {
    const administrator = await adminId();
    await client.begin(async (transaction) => {
      /* Only the first revoke is an event. Voiding an already-void key is a
         no-op, and RETURNING lets the write itself decide that rather than a
         separate read that could race another administrator. */
      const [revoked] = await transaction<{ user_id: string; key_prefix: string }[]>`
        UPDATE api_keys SET revoked_at = now()
        WHERE id = ${data.keyId} AND revoked_at IS NULL
        RETURNING user_id, key_prefix
      `;
      if (!revoked) return;
      const [identity] = await transaction<{ workspace_id: string }[]>`
        SELECT workspace_id FROM users WHERE id = ${revoked.user_id}
      `;
      if (!identity) return;
      const [managed] = await transaction<{ label: string }[]>`
        SELECT label FROM managed_api_key WHERE id = ${data.keyId}
      `;
      await transaction`
        INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
        VALUES (${identity.workspace_id}, ${administrator}, 'api_key_revoked',
          ${JSON.stringify({
            identityId: revoked.user_id,
            keyId: data.keyId,
            prefix: revoked.key_prefix,
            label: managed?.label ?? null,
          })}::jsonb)
      `;
    });
    return { revoked: true };
  });

/* People — the humans who can sign in, and what each of them may do.
 *
 * Distinct from the identities above: those are agent holders in the knowledge
 * schema (`users`, uuid), these are better-auth accounts (`"user"`, text) with
 * a row in `member`. The two never mix, which is why the register can show a
 * holder called "Admin" that is nobody's colleague.
 *
 * They do share a role vocabulary, deliberately — see `roles.ts`. A human
 * writer and an agent writer are granted the same four verbs. */
export type Person = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  isYou: boolean;
};

/* Unpaginated on purpose, unlike `listIdentities`. These are people with a
   password to this instance; if that list ever needs a cursor, something has
   gone wrong that pagination would only hide. */
export const listPeople = createServerFn({ method: 'GET' }).handler(async (): Promise<Person[]> => {
  const { userId: you, workspaceId } = await requireMember('admin');
  /* `created_at` comes back as a string, not a Date. `drizzle()` mutates the
     client it is handed (see `db.ts`) and that extends to its date parsers, so
     this client hands back raw Postgres timestamps while a bare postgres.js
     client would give you a Date. Pass it through untouched: `<Stamp>` takes
     either shape and normalises it, which is what every register here does. */
  const rows = await client<
    { id: string; name: string; email: string; role: string; created_at: string }[]
  >`
    SELECT "user".id, "user".name, "user".email, member.role, member.created_at
    FROM member
    JOIN "user" ON "user".id = member.user_id
    WHERE member.workspace_id = ${workspaceId}
    ORDER BY member.created_at ASC, "user".email ASC
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: isRole(row.role) ? row.role : 'reader',
    createdAt: row.created_at,
    isYou: row.id === you,
  }));
});

/* Raising or lowering what someone may do.
 *
 * The last-administrator guard is the point of the transaction: without it,
 * demoting yourself when you are the only admin locks the instance out of its
 * own people register, credentials and review queue, with no way back through
 * the browser. Counted inside the same transaction as the update so two
 * simultaneous demotions cannot both see a second admin that is about to
 * disappear. */
export const updatePersonRole = createServerFn({ method: 'POST' })
  .validator((value: unknown): { userId: string; role: Role } => {
    const input = (value ?? {}) as Partial<{ userId: string; role: string }>;
    const userId = input.userId?.trim();
    if (!userId) throw new Error('Invalid person');
    if (!isRole(input.role)) throw new Error('Invalid role');
    return { userId, role: input.role };
  })
  .handler(async ({ data }) => {
    const { userId: actor, workspaceId } = await requireMember('admin');
    await client.begin(async (transaction) => {
      const [before] = await transaction<{ role: string }[]>`
        SELECT role FROM member
        WHERE workspace_id = ${workspaceId} AND user_id = ${data.userId}
        FOR UPDATE
      `;
      if (!before) throw new Error('That person is no longer a member.');
      if (before.role === data.role) return;
      if (before.role === 'admin' && data.role !== 'admin') {
        const [{ count }] = await transaction<{ count: string }[]>`
          SELECT count(*) FROM member
          WHERE workspace_id = ${workspaceId} AND role = 'admin'
        `;
        if (Number(count) <= 1) {
          throw new Error('This is the only administrator. Promote someone else first.');
        }
      }
      await transaction`
        UPDATE member SET role = ${data.role}
        WHERE workspace_id = ${workspaceId} AND user_id = ${data.userId}
      `;
      await transaction`
        INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
        VALUES (${workspaceId}, ${actor}, 'member_role_changed',
          ${JSON.stringify({ userId: data.userId, from: before.role, to: data.role })}::jsonb)
      `;
    });
    return { role: data.role };
  });

/* Removing someone's access.
 *
 * The membership goes; the account and everything they wrote stay. Sources
 * carry `created_by_admin_id` with `ON DELETE SET NULL`, so deleting the
 * account would quietly unattribute their submissions — which is the opposite
 * of what a provenance product should do when someone leaves. */
export const removePerson = createServerFn({ method: 'POST' })
  .validator((value: unknown): { userId: string } => {
    const userId = (value as { userId?: string })?.userId?.trim();
    if (!userId) throw new Error('Invalid person');
    return { userId };
  })
  .handler(async ({ data }) => {
    const { userId: actor, workspaceId } = await requireMember('admin');
    if (data.userId === actor) throw new Error('You cannot remove your own access.');
    await client.begin(async (transaction) => {
      const [removed] = await transaction<{ role: string }[]>`
        DELETE FROM member
        WHERE workspace_id = ${workspaceId} AND user_id = ${data.userId}
        RETURNING role
      `;
      /* Already gone. The register reloads without them and there is nothing
         for the administrator to correct. */
      if (!removed) return;
      await transaction`
        INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
        VALUES (${workspaceId}, ${actor}, 'member_removed',
          ${JSON.stringify({ userId: data.userId, role: removed.role })}::jsonb)
      `;
    });
    return { removed: true };
  });

export type Invitation = {
  id: string;
  email: string;
  name: string;
  role: Role;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

/* Long enough to survive a weekend and a holiday Monday; short enough that a
   link forgotten in a chat log stops working. */
const INVITATION_DAYS = 7;

const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');

/* Add a teammate without ever holding their password.
 *
 * This used to take an initial password, which the issuer typed, read off the
 * screen and passed along — then told the recipient to replace it. That
 * instruction was correct and was also an admission that the mechanism was
 * wrong. Now the issuer mints a single-use link and the recipient chooses a
 * password nobody else has seen.
 *
 * An address that already has an account takes the *add* branch: it needs no
 * password, so there is nothing to invite them to set. That branch is not only
 * a convenience. An invitation able to act on an existing account would be an
 * account-takeover primitive — invite a colleague's address, redeem it
 * yourself, own their login. This check and the matching one in
 * `acceptInvitation` are what make that impossible.
 *
 * Sign-up stays closed throughout. `provisioning` (see `auth.ts`) is the only
 * thing that creates accounts, and the public `POST /api/auth/sign-up/email`
 * route keeps refusing. */
export const invitePerson = createServerFn({ method: 'POST' })
  .validator((value: unknown): { name: string; email: string; role: Role } => {
    const input = (value ?? {}) as Partial<{ name: string; email: string; role: string }>;
    const email = input.email?.trim().toLowerCase();
    const name = input.name?.trim();
    if (!name) throw new Error('A name is required.');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw new Error('That does not look like an email address.');
    /* No default. The inviter decides what this person may do, every time —
       a role that arrives by omission is one nobody chose. */
    if (!isRole(input.role)) throw new Error('Choose a role for this person.');
    return { name, email, role: input.role };
  })
  .handler(async ({ data }) => {
    const { userId: invitedBy, workspaceId } = await requireMember('admin');

    const [existing] = await client<
      { id: string }[]
    >`SELECT id FROM "user" WHERE lower(email) = ${data.email}`;
    if (existing) {
      const [already] = await client<{ role: string }[]>`
        SELECT role FROM member
        WHERE workspace_id = ${workspaceId} AND user_id = ${existing.id}
      `;
      if (already) throw new Error(`${data.email} is already a member of this workspace.`);
      await client.begin(async (transaction) => {
        await transaction`
          INSERT INTO member (workspace_id, user_id, role)
          VALUES (${workspaceId}, ${existing.id}, ${data.role})
          ON CONFLICT (workspace_id, user_id) DO NOTHING
        `;
        await transaction`
          INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
          VALUES (${workspaceId}, ${invitedBy}, 'member_added',
            ${JSON.stringify({ email: data.email, role: data.role })}::jsonb)
        `;
      });
      return { email: data.email, added: true, role: data.role, token: null as string | null };
    }

    const token = `inv_${randomBytes(32).toString('base64url')}`;
    await client.begin(async (transaction) => {
      /* Supersede any outstanding link for this address rather than collide
         with the partial unique index. Re-inviting should mean "here is a fresh
         link", not an error about one they never used. */
      await transaction`
        UPDATE member_invitation SET revoked_at = now()
        WHERE lower(email) = ${data.email} AND accepted_at IS NULL AND revoked_at IS NULL
      `;
      await transaction`
        INSERT INTO member_invitation (email, name, token_hash, workspace_id, role, invited_by, expires_at)
        VALUES (${data.email}, ${data.name}, ${tokenDigest(token)}, ${workspaceId}, ${data.role},
                ${invitedBy}, now() + ${`${INVITATION_DAYS} days`}::interval)
      `;
      await transaction`
        INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
        VALUES (${workspaceId}, ${invitedBy}, 'member_invited',
          ${JSON.stringify({ email: data.email, role: data.role })}::jsonb)
      `;
    });

    return { email: data.email, added: false, role: data.role, token: token as string | null };
  });

/* A pending invitation is a live credential to this surface, so it has to be
   visible and cancellable. Expired ones stay listed: knowing a link went unused
   is the difference between chasing someone and reissuing. */
export const listInvitations = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Invitation[]> => {
    const { workspaceId } = await requireMember('admin');
    const rows = await client<
      {
        id: string;
        email: string;
        name: string;
        role: string;
        invited_by: string;
        created_at: string;
        expires_at: string;
        expired: boolean;
      }[]
    >`
      SELECT invitation.id, invitation.email, invitation.name, invitation.role,
             COALESCE(NULLIF(inviter.name, ''), inviter.email, 'an administrator') AS invited_by,
             invitation.created_at, invitation.expires_at,
             invitation.expires_at <= now() AS expired
      FROM member_invitation AS invitation
      LEFT JOIN "user" AS inviter ON inviter.id = invitation.invited_by
      WHERE invitation.workspace_id = ${workspaceId}
        AND invitation.accepted_at IS NULL AND invitation.revoked_at IS NULL
      ORDER BY invitation.created_at DESC
    `;
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: isRole(row.role) ? row.role : 'reader',
      invitedBy: row.invited_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      expired: row.expired,
    }));
  }
);

export const revokeInvitation = createServerFn({ method: 'POST' })
  .validator((value: unknown): { invitationId: string } => {
    const id = (value as { invitationId?: string })?.invitationId?.trim();
    if (!id || !UUID.test(id)) throw new Error('Invalid invitation');
    return { invitationId: id };
  })
  .handler(async ({ data }) => {
    const { userId: revokedBy, workspaceId } = await requireMember('admin');
    await client.begin(async (transaction) => {
      const [revoked] = await transaction<{ email: string }[]>`
        UPDATE member_invitation SET revoked_at = now()
        WHERE id = ${data.invitationId} AND workspace_id = ${workspaceId}
          AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING email
      `;
      /* Already spent or already revoked. The list reloads without it; there is
         nothing for the administrator to correct. */
      if (!revoked) return;
      await transaction`
        INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
        VALUES (${workspaceId}, ${revokedBy},
          'member_invitation_revoked', ${JSON.stringify({ email: revoked.email })}::jsonb)
      `;
    });
    return { revoked: true };
  });

/* Every reason a link can fail, and the sentence for each.
 *
 * They are separated because they send the reader somewhere different: *used*
 * means go and sign in, *revoked* and *expired* mean go back to whoever invited
 * you, and *already has an account* means the link was never going to work.
 * Collapsing them into one message would tell someone with no account to sign
 * in — advice that cannot succeed.
 *
 * A token that was never issued gets the flattest sentence of the four, and
 * nothing distinguishes it from one aimed at a different instance. */
async function inspectInvitation(token: string) {
  const [invitation] = await client<
    {
      id: string;
      email: string;
      name: string;
      role: string;
      workspace_id: string;
      invited_by: string;
      expired: boolean;
      accepted: boolean;
      revoked: boolean;
    }[]
  >`
    SELECT invitation.id, invitation.email, invitation.name, invitation.role,
           invitation.workspace_id,
           COALESCE(NULLIF(inviter.name, ''), inviter.email, 'an administrator') AS invited_by,
           invitation.expires_at <= now() AS expired,
           invitation.accepted_at IS NOT NULL AS accepted,
           invitation.revoked_at IS NOT NULL AS revoked
    FROM member_invitation AS invitation
    LEFT JOIN "user" AS inviter ON inviter.id = invitation.invited_by
    WHERE invitation.token_hash = ${tokenDigest(token)}
  `;
  if (!invitation) throw new Error('That invitation link is not valid.');
  if (invitation.accepted)
    throw new Error('That invitation has already been used. Sign in instead.');
  if (invitation.revoked)
    throw new Error('That invitation was withdrawn. Ask whoever invited you for a new link.');
  if (invitation.expired) throw new Error('That invitation has expired. Ask for a new link.');

  /* Checked here, not only at redemption, so the page refuses up front instead
     of showing a password form that cannot succeed. The address may have
     acquired an account since the link was minted — by the bootstrap script, or
     by another invitation — and a token able to set its password would be a
     takeover. `acceptInvitation` repeats the check rather than trusting this
     one; between the two calls is a window. */
  const [existing] = await client<
    { id: string }[]
  >`SELECT id FROM "user" WHERE lower(email) = ${invitation.email.toLowerCase()}`;
  if (existing) throw new Error(`${invitation.email} already has an account. Sign in instead.`);

  return invitation;
}

/* What the invite page shows before asking for a password: who invited you,
 * which address this is for, and what you will be able to do.
 *
 * Unauthenticated, necessarily — the reader has no account yet. */
export const readInvitation = createServerFn({ method: 'GET' })
  .validator((value: unknown): { token: string } => {
    const token = (value as { token?: string })?.token?.trim();
    if (!token) throw new Error('That invitation link is not valid.');
    return { token };
  })
  .handler(async ({ data }) => {
    const invitation = await inspectInvitation(data.token);
    return {
      email: invitation.email,
      name: invitation.name,
      role: isRole(invitation.role) ? invitation.role : ('reader' as Role),
      invitedBy: invitation.invited_by,
    };
  });

/* Redeeming an invitation. **Not gated on `requireMember()`** — the holder has
 * no account yet, so there is no session to check. The token is the
 * authorisation, which is why it is 256 bits, single-use, expiring, and stored
 * only as a digest.
 *
 * `inspectInvitation` runs again here rather than trusting what the page was
 * told. Between rendering the form and submitting it, the link may have been
 * revoked, or that address may have acquired an account by another route — and
 * a token that could then set its password would be a takeover.
 *
 * The invitation is claimed with a conditional UPDATE *before* the account is
 * made, so two simultaneous redemptions cannot both pass; if account creation
 * then fails, the transaction rolls the claim back with it. */
export const acceptInvitation = createServerFn({ method: 'POST' })
  .validator((value: unknown): { token: string; password: string } => {
    const input = (value ?? {}) as Partial<{ token: string; password: string }>;
    const token = input.token?.trim();
    if (!token) throw new Error('That invitation link is not valid.');
    /* Matches better-auth's `minPasswordLength` default, which is what actually
       enforces it — checking here only saves a round trip. */
    if (!input.password || input.password.length < 8) {
      throw new Error('Use at least 8 characters.');
    }
    return { token, password: input.password };
  })
  .handler(async ({ data }) => {
    const invitation = await inspectInvitation(data.token);
    const email = invitation.email.toLowerCase();
    const role = isRole(invitation.role) ? invitation.role : ('reader' as Role);

    await client.begin(async (transaction) => {
      const [claimed] = await transaction<{ id: string }[]>`
        UPDATE member_invitation SET accepted_at = now()
        WHERE id = ${invitation.id} AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING id
      `;
      if (!claimed) throw new Error('That invitation has already been used. Sign in instead.');

      await provisioning.api.signUpEmail({
        body: { name: invitation.name, email: invitation.email, password: data.password },
      });
      const [created] = await transaction<{ id: string }[]>`
        SELECT id FROM "user" WHERE lower(email) = ${email}
      `;
      if (!created) throw new Error('The account could not be created. Nothing was changed.');
      await transaction`
        INSERT INTO member (workspace_id, user_id, role)
        VALUES (${invitation.workspace_id}, ${created.id}, ${role})
        ON CONFLICT (workspace_id, user_id) DO NOTHING
      `;
      await transaction`
        INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
        VALUES (${invitation.workspace_id}, ${created.id},
          'member_joined', ${JSON.stringify({ email: invitation.email, role })}::jsonb)
      `;
    });

    return { email: invitation.email, role };
  });

/* Changing your own name and password goes through `authClient.updateUser` and
   `authClient.changePassword` on the client rather than a server function here.
   Both are better-auth's own routes: they run its hooks, re-issue the session,
   and — for the password — verify the current one and revoke other sessions.
   A raw UPDATE against `"user"` would do none of that. */
