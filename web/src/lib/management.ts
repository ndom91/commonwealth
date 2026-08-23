import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { clientIp, FixedWindow } from '@commonwealth/rate-limit';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { provisioning } from './auth.js';
import {
  requireArchivedAdmin,
  requireMember,
  type Scoped,
  SLUG,
  validateProject,
  validateScope,
} from './authorize.js';
import { PAGE_SIZE } from './concepts.js';
import { client } from './db.js';
import { fileEvent } from './events.js';
import { can, canGrant, isRole, type Role } from './roles.js';

/* Checked before the value reaches a `::uuid` cast, so a malformed id comes
   back as a sentence rather than a Postgres syntax error. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Marks a credential as this product's, and its first 12 characters are stored
 * as `api_keys.key_prefix` — the indexed column a presented key is looked up by.
 *
 * It was `tkb_` before the rename. Changing it is not a migration and not a
 * break: lookup goes through the *stored* prefix, never a literal, so keys
 * already in agents' configs keep authenticating. They also cannot be rewritten
 * — the secret exists only where the holder put it — so a project that
 * predates the rename will show both markings in its register indefinitely.
 * That is the honest cost of the change, and it is cosmetic. */
const KEY_PREFIX = 'cw_';

function mintSecret(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

type IdentityInput = { name: string; role: Role; keyLabel: string; unowned: boolean };
type IdentityAmendment = {
  name: string;
  role: Role;
  description: string | null;
  autoApprove: boolean;
};

/* Everything in this module manages who may act — agent credentials and the
 * people who hold accounts — so it is behind `admin` *in the project named by
 * the caller*, with two deliberate exceptions.
 *
 * The first is redeeming an invitation, where the token is the authorisation
 * and there is no session yet.
 *
 * The second is a member minting a holder for themselves. `listIdentities` and
 * `createIdentity` take `write`, because needing an administrator to get your
 * own agent a read-only credential is friction with nothing on the other side
 * of it. What they do *not* take is anybody else's holder: a non-administrator
 * sees only what they own, cannot mint above their own role, and cannot mint a
 * trusted one. Amending, disabling, voiding and issuing against an existing
 * holder all remain `admin` — those reach holders you may not own.
 *
 * Both halves are per-project. Agent identities carry `users.project_id`
 * and members carry `member.project_id`, so an administrator of one project
 * can neither see nor void the credentials of another. */
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
  .validator(
    (
      value: unknown
    ): Scoped<{ cursor: { createdAt: string; id: string } | null; mine: boolean }> => {
      const input = (value ?? {}) as {
        cursor?: { createdAt?: string; id?: string };
        mine?: boolean;
      };
      const project = validateProject(value);
      const mine = input.mine === true;
      if (!input.cursor) return { project, cursor: null, mine };
      if (!input.cursor.createdAt || !input.cursor.id) throw new Error('Invalid cursor');
      return {
        project,
        cursor: { createdAt: input.cursor.createdAt, id: input.cursor.id },
        mine,
      };
    }
  )
  .handler(async ({ data }) => {
    const { userId, projectId, role } = await requireMember('write', data.project);
    /* An administrator sees every holder in the project and may narrow to
       their own. Anyone else sees only their own, whatever they asked for — so
       `mine` is a convenience at the top of the register and the boundary
       underneath it, and the two cannot disagree. */
    const mine = data.mine || !can(role, 'admin');
    const rows = await client`
      SELECT users.id, users.display_name AS name, users.role, users.created_at, users.description,
        users.disabled_at, users.auto_approve, users.owner_admin_id,
        -- Null for an unowned holder, which is a real state rather than a gap:
        -- the bootstrap identity and any shared runner are nobody's. The
        -- Coalesce the account name and address because
        -- a better-auth account may carry an empty name and the address is a
        -- better answer than a blank.
        COALESCE(NULLIF(owner_account.name, ''), owner_account.email) AS owner,
        COALESCE(json_agg(json_build_object('id', api_keys.id, 'prefix', api_keys.key_prefix, 'label', managed_api_key.label, 'createdAt', api_keys.created_at, 'lastUsedAt', api_keys.last_used_at, 'revokedAt', api_keys.revoked_at)
          ORDER BY api_keys.created_at DESC) FILTER (WHERE api_keys.id IS NOT NULL), '[]') AS keys
      FROM users
      LEFT JOIN api_keys ON api_keys.user_id = users.id
      LEFT JOIN managed_api_key ON managed_api_key.id = api_keys.id
      LEFT JOIN "user" AS owner_account ON owner_account.id = users.owner_admin_id
      WHERE users.project_id = ${projectId}
        AND (${mine} = false OR users.owner_admin_id = ${userId})
        AND (
          ${data.cursor?.createdAt ?? null}::timestamptz IS NULL
          OR (users.created_at, users.id)
             < (${data.cursor?.createdAt ?? null}::timestamptz, ${data.cursor?.id ?? null}::uuid)
        )
      -- owner_account.id is that table's primary key, so grouping by it lets
      -- the name and address above out without widening the grouping.
      GROUP BY users.id, owner_account.id
      ORDER BY users.created_at DESC, users.id DESC
      LIMIT ${PAGE_SIZE + 1}
    `;
    /* One row past the page proves another page exists without counting the
       whole table. */
    const hasMore = rows.length > PAGE_SIZE;
    return { identities: rows.slice(0, PAGE_SIZE), hasMore };
  });

export const createIdentity = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<IdentityInput> => {
    const input = value as Partial<IdentityInput>;
    if (
      !input.name?.trim() ||
      !input.keyLabel?.trim() ||
      !['reader', 'writer', 'reviewer', 'admin'].includes(input.role ?? '')
    )
      throw new Error('Invalid identity details');
    return {
      project: validateProject(value),
      name: input.name.trim(),
      keyLabel: input.keyLabel.trim(),
      role: input.role as IdentityInput['role'],
      unowned: input.unowned === true,
    };
  })
  .handler(async ({ data }) => {
    const {
      userId: createdByAdminId,
      projectId,
      role,
    } = await requireMember('write', data.project);
    /* Nobody mints a credential that can do more than they can. Checked here
       rather than in the form, because the form is a drawing of the rule and
       this is the rule — the route is a plain HTTP endpoint and a `reader` role
       on the wire arrives the same way whichever control produced it. */
    if (!canGrant(role, data.role)) {
      throw new Error(`You cannot issue a ${data.role} credential: it exceeds your own access.`);
    }
    /* An administrator may leave a holder unowned, which is what a shared runner
       or a bootstrap identity is. Everyone else owns what they mint, whatever
       the payload says — an unowned holder is one that offboarding will not
       retire, and that is an administrator's decision to make.
     *
     * `auto_approve` needs no guard here: this insert never sets it, so a new
     * holder is untrusted by default and only `updateIdentity` — still `admin`
     * — can change that. */
    const owner = data.unowned && can(role, 'admin') ? null : createdByAdminId;
    const secret = mintSecret();
    const salt = randomBytes(16).toString('hex');
    const secretHash = `${salt}:${scryptSync(secret, salt, 32).toString('hex')}`;
    const keyId = randomUUID();
    let identityId: string | undefined;
    await client.begin(async (transaction) => {
      /* Filed under the project the caller is looking at. An agent belongs to
         exactly one project — `mcp-server/src/access-service.ts` reads
         `users.project_id` off the key and scopes everything to it — so this
         is also the decision about which corpus the credential can reach. */
      const [identity] = await transaction<{ id: string }[]>`
        INSERT INTO users (project_id, display_name, role, owner_admin_id)
        VALUES (${projectId}, ${data.name}, ${data.role}, ${owner})
        RETURNING id
      `;
      if (!identity) throw new Error('Unable to create identity');
      identityId = identity.id;
      await transaction`
        INSERT INTO api_keys (id, user_id, key_prefix, secret_hash)
        VALUES (${keyId}, ${identity.id}, ${secret.slice(0, 12)}, ${secretHash})
      `;
      await transaction`
        INSERT INTO managed_api_key (id, knowledge_user_id, label, created_by_admin_id)
        VALUES (${keyId}, ${identity.id}, ${data.keyLabel}, ${createdByAdminId})
      `;
      await fileEvent(transaction, {
        projectId,
        actor: createdByAdminId,
        type: 'api_key_created',
        metadata: { identityId: identity.id, keyId, label: data.keyLabel },
      });
    });
    if (!identityId) throw new Error('Unable to create identity');
    return { identityId, key: secret, prefix: secret.slice(0, 12) };
  });

/* Amend a holder's record. Role changes alter what every credential this
   holder owns is permitted to do, so the change is written to the event log
   alongside the values it replaced. */
export const updateIdentity = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ identityId: string } & IdentityAmendment> => {
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
      project: validateProject(value),
      identityId: input.identityId.trim(),
      name: input.name.trim(),
      role: input.role as IdentityAmendment['role'],
      description: input.description?.trim() || null,
      autoApprove: input.autoApprove,
    };
  })
  .handler(async ({ data }) => {
    const { userId: administrator, projectId } = await requireMember('admin', data.project);
    await client.begin(async (transaction) => {
      const [before] = await transaction<
        {
          project_id: string;
          display_name: string;
          role: string;
          description: string | null;
          auto_approve: boolean;
        }[]
      >`
        SELECT project_id, display_name, role, description, auto_approve
        FROM users WHERE id = ${data.identityId} AND project_id = ${projectId}
      `;
      if (!before) throw new Error('That identity no longer exists');
      await transaction`
        UPDATE users
        SET display_name = ${data.name}, role = ${data.role}, description = ${data.description},
            auto_approve = ${data.autoApprove}
        WHERE id = ${data.identityId} AND project_id = ${projectId}
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
        await fileEvent(transaction, {
          projectId: before.project_id,
          actor: administrator,
          type: 'identity_amended',
          metadata: { identityId: data.identityId, changed },
        });
      }
    });
    return { identityId: data.identityId };
  });

/* Suspend or restore a holder in one move. AccessService only authenticates
   keys whose holder has `disabled_at IS NULL`, so disabling blocks every
   credential this holder owns at the MCP boundary immediately — and, unlike
   revoking, it is reversible and destroys nothing. */
export const setIdentityDisabled = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ identityId: string; disabled: boolean }> => {
    const input = value as Partial<{ identityId: string; disabled: boolean }>;
    if (!input.identityId?.trim()) throw new Error('Invalid identity');
    if (typeof input.disabled !== 'boolean') throw new Error('Invalid state');
    return {
      project: validateProject(value),
      identityId: input.identityId.trim(),
      disabled: input.disabled,
    };
  })
  .handler(async ({ data }) => {
    const { userId: administrator, projectId } = await requireMember('admin', data.project);
    await client.begin(async (transaction) => {
      const [identity] = await transaction<{ project_id: string; disabled_at: string | null }[]>`
        SELECT project_id, disabled_at FROM users
        WHERE id = ${data.identityId} AND project_id = ${projectId}
      `;
      if (!identity) throw new Error('That identity no longer exists');
      if (data.disabled === Boolean(identity.disabled_at)) return;
      /* Branch rather than interpolating a `now()` fragment: a fragment built
         from the pooled client is not the transaction's handle, and the write
         silently produced no timestamp. */
      if (data.disabled) {
        await transaction`
          UPDATE users SET disabled_at = now()
          WHERE id = ${data.identityId} AND project_id = ${projectId}
        `;
      } else {
        await transaction`
          UPDATE users SET disabled_at = NULL
          WHERE id = ${data.identityId} AND project_id = ${projectId}
        `;
      }
      await fileEvent(transaction, {
        projectId: identity.project_id,
        actor: administrator,
        type: data.disabled ? 'identity_disabled' : 'identity_enabled',
        metadata: { identityId: data.identityId },
      });
    });
    return { identityId: data.identityId, disabled: data.disabled };
  });

/* Issue an additional credential to an existing holder. Rotation is a normal
   custody operation: a holder outlives any one credential, so voiding a key
   must never strand the identity that held it. */
export const issueCredential = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ identityId: string; keyLabel: string }> => {
    const input = value as Partial<{ identityId: string; keyLabel: string }>;
    if (!input.identityId?.trim() || !input.keyLabel?.trim())
      throw new Error('Invalid credential details');
    return {
      project: validateProject(value),
      identityId: input.identityId.trim(),
      keyLabel: input.keyLabel.trim(),
    };
  })
  .handler(async ({ data }) => {
    const { userId: createdByAdminId, projectId } = await requireMember('admin', data.project);
    const secret = mintSecret();
    const salt = randomBytes(16).toString('hex');
    const secretHash = `${salt}:${scryptSync(secret, salt, 32).toString('hex')}`;
    const keyId = randomUUID();
    await client.begin(async (transaction) => {
      const [identity] = await transaction<{ id: string; project_id: string }[]>`
        SELECT id, project_id FROM users
        WHERE id = ${data.identityId} AND project_id = ${projectId}
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
      await fileEvent(transaction, {
        projectId: identity.project_id,
        actor: createdByAdminId,
        type: 'api_key_created',
        metadata: { identityId: identity.id, keyId, label: data.keyLabel },
      });
    });
    return { identityId: data.identityId, key: secret, prefix: secret.slice(0, 12) };
  });

export const revokeKey = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ keyId: string }> => {
    const keyId = (value as { keyId?: string }).keyId;
    if (!keyId) throw new Error('Invalid key');
    return { project: validateProject(value), keyId };
  })
  .handler(async ({ data }) => {
    const { userId: administrator, projectId } = await requireMember('admin', data.project);
    await client.begin(async (transaction) => {
      /* Only the first revoke is an event. Voiding an already-void key is a
         no-op, and RETURNING lets the write itself decide that rather than a
         separate read that could race another administrator. */
      /* `api_keys` has no project of its own, so the scope rides in through
         its holder — in the same statement, so a key belonging to another
         project is never voided and then discovered to be foreign. */
      const [revoked] = await transaction<{ user_id: string; key_prefix: string }[]>`
        UPDATE api_keys SET revoked_at = now()
        WHERE id = ${data.keyId} AND revoked_at IS NULL
          AND user_id IN (SELECT id FROM users WHERE project_id = ${projectId})
        RETURNING user_id, key_prefix
      `;
      if (!revoked) return;
      const [identity] = await transaction<{ project_id: string }[]>`
        SELECT project_id FROM users WHERE id = ${revoked.user_id}
      `;
      if (!identity) return;
      const [managed] = await transaction<{ label: string }[]>`
        SELECT label FROM managed_api_key WHERE id = ${data.keyId}
      `;
      await fileEvent(transaction, {
        projectId: identity.project_id,
        actor: administrator,
        type: 'api_key_revoked',
        metadata: {
          identityId: revoked.user_id,
          keyId: data.keyId,
          prefix: revoked.key_prefix,
          label: managed?.label ?? null,
        },
      });
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
  /* What removing them would retire: the agent holders they own here that are
     still in service, and the credentials still live against those holders.
     Counted so the confirmation can state the cost before it is paid — a
     removal that silently kills a bot is how a corpus goes quiet. Already
     disabled holders and already voided keys are excluded; they are not about
     to be taken out of service. */
  holders: number;
  liveCredentials: number;
};

/* Unpaginated on purpose, unlike `listIdentities`. These are people with a
   password to this instance; if that list ever needs a cursor, something has
   gone wrong that pagination would only hide. */
export const listPeople = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }): Promise<Person[]> => {
    const { userId: you, projectId } = await requireMember('admin', data.project);
    /* `created_at` comes back as a string, not a Date. `drizzle()` mutates the
     client it is handed (see `db.ts`) and that extends to its date parsers, so
     this client hands back raw Postgres timestamps while a bare postgres.js
     client would give you a Date. Pass it through untouched: `<Stamp>` takes
     either shape and normalises it, which is what every register here does. */
    const rows = await client<
      {
        id: string;
        name: string;
        email: string;
        role: string;
        created_at: string;
        holders: string;
        live_credentials: string;
      }[]
    >`
    SELECT "user".id, "user".name, "user".email, member.role, member.created_at,
      (SELECT count(*) FROM users
        WHERE users.project_id = member.project_id
          AND users.owner_admin_id = "user".id
          AND users.disabled_at IS NULL) AS holders,
      (SELECT count(*) FROM api_keys
        JOIN users ON users.id = api_keys.user_id
        WHERE users.project_id = member.project_id
          AND users.owner_admin_id = "user".id
          AND api_keys.revoked_at IS NULL) AS live_credentials
    FROM member
    JOIN "user" ON "user".id = member.user_id
    WHERE member.project_id = ${projectId}
    ORDER BY member.created_at ASC, "user".email ASC
  `;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: isRole(row.role) ? row.role : 'reader',
      createdAt: row.created_at,
      isYou: row.id === you,
      /* `count(*)` is a bigint, and postgres.js hands those back as strings so
         a value past 2^53 is not quietly rounded. These are small. */
      holders: Number(row.holders),
      liveCredentials: Number(row.live_credentials),
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
  .validator((value: unknown): Scoped<{ userId: string; role: Role }> => {
    const input = (value ?? {}) as Partial<{ userId: string; role: string }>;
    const userId = input.userId?.trim();
    if (!userId) throw new Error('Invalid person');
    if (!isRole(input.role)) throw new Error('Invalid role');
    return { project: validateProject(value), userId, role: input.role };
  })
  .handler(async ({ data }) => {
    const { userId: actor, projectId } = await requireMember('admin', data.project);
    await client.begin(async (transaction) => {
      const [before] = await transaction<{ role: string }[]>`
        SELECT role FROM member
        WHERE project_id = ${projectId} AND user_id = ${data.userId}
        FOR UPDATE
      `;
      if (!before) throw new Error('That person is no longer a member.');
      if (before.role === data.role) return;
      if (before.role === 'admin' && data.role !== 'admin') {
        const [{ count }] = await transaction<{ count: string }[]>`
          SELECT count(*) FROM member
          WHERE project_id = ${projectId} AND role = 'admin'
        `;
        if (Number(count) <= 1) {
          throw new Error('This is the only administrator. Promote someone else first.');
        }
      }
      await transaction`
        UPDATE member SET role = ${data.role}
        WHERE project_id = ${projectId} AND user_id = ${data.userId}
      `;
      await fileEvent(transaction, {
        projectId,
        actor,
        type: 'member_role_changed',
        metadata: { userId: data.userId, from: before.role, to: data.role },
      });
    });
    return { role: data.role };
  });

/* Removing someone's access, and retiring the agents they held.
 *
 * The membership goes; the account and its attributable history stay. Deleting
 * the account would quietly unattribute its concept commits — which is the
 * opposite of what a provenance product should do when someone leaves.
 *
 * Their *credentials* are a different question, and the answer is that they
 * stop working. A key outliving the person it was minted for is an agent
 * reading a corpus nobody on it is answerable for. Anything shared that breaks
 * as a result is an administrator's to re-issue, deliberately, under a holder
 * that is not one person's.
 *
 * "Retired" here means voided and disabled, not deleted. The `users` row cannot
 * be deleted — `events.actor_admin_id` and `api_keys.user_id` reference it with
 * no `ON DELETE` clause, so a delete raises a foreign-key violation for any
 * holder with recorded activity. That is the schema agreeing with Principle 2:
 * nothing here may make history unrecoverable. Voiding the secrets achieves what
 * deletion was wanted for; the row stays so the corpus keeps its provenance. */
export const removePerson = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ userId: string }> => {
    const userId = (value as { userId?: string })?.userId?.trim();
    if (!userId) throw new Error('Invalid person');
    return { project: validateProject(value), userId };
  })
  .handler(async ({ data }) => {
    const { userId: actor, projectId } = await requireMember('admin', data.project);
    if (data.userId === actor) throw new Error('You cannot remove your own access.');
    let retired = { holders: 0, credentials: 0 };
    await client.begin(async (transaction) => {
      const [removed] = await transaction<{ role: string }[]>`
        DELETE FROM member
        WHERE project_id = ${projectId} AND user_id = ${data.userId}
        RETURNING role
      `;
      /* Already gone. The register reloads without them and there is nothing
         for the administrator to correct. */
      if (!removed) return;
      await fileEvent(transaction, {
        projectId,
        actor,
        type: 'member_removed',
        metadata: { userId: data.userId, role: removed.role },
      });

      /* Scoped to the project being left, so holders this person owns in a
         project they are still a member of keep working. The scope rides in
         through the holder in the same statement as the void, so a key in
         another project is never voided and then found to be foreign. */
      const voided = await transaction<{ id: string; user_id: string; key_prefix: string }[]>`
        UPDATE api_keys SET revoked_at = now()
        WHERE revoked_at IS NULL
          AND user_id IN (
            SELECT id FROM users
            WHERE project_id = ${projectId} AND owner_admin_id = ${data.userId}
          )
        RETURNING id, user_id, key_prefix
      `;
      /* Both, not either. Voiding kills the secrets and cannot be undone;
         disabling is the gate `AccessService` checks on every presentation, and
         covers any key minted against the holder between now and someone
         noticing. */
      const disabled = await transaction<{ id: string }[]>`
        UPDATE users SET disabled_at = now()
        WHERE project_id = ${projectId} AND owner_admin_id = ${data.userId}
          AND disabled_at IS NULL
        RETURNING id
      `;
      retired = { holders: disabled.length, credentials: voided.length };

      for (const key of voided) {
        const [managed] = await transaction<{ label: string }[]>`
          SELECT label FROM managed_api_key WHERE id = ${key.id}
        `;
        await fileEvent(transaction, {
          projectId,
          actor,
          type: 'api_key_revoked',
          metadata: {
            identityId: key.user_id,
            keyId: key.id,
            prefix: key.key_prefix,
            label: managed?.label ?? null,
          },
        });
      }
      /* Filed per holder and marked `offboarded`, which is what tells the
         activity log to treat this disable as notable. An administrator
         disabling a holder by hand is reversible and stays quiet; this one is
         not, and a log that under-reports it is describing a project that did
         not happen. */
      for (const holder of disabled) {
        await fileEvent(transaction, {
          projectId,
          actor,
          type: 'identity_disabled',
          metadata: { identityId: holder.id, reason: 'offboarded', ownerId: data.userId },
        });
      }
    });
    return { removed: true, retired };
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
  .validator((value: unknown): Scoped<{ name: string; email: string; role: Role }> => {
    const input = (value ?? {}) as Partial<{ name: string; email: string; role: string }>;
    const email = input.email?.trim().toLowerCase();
    const name = input.name?.trim();
    if (!name) throw new Error('A name is required.');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw new Error('That does not look like an email address.');
    /* No default. The inviter decides what this person may do, every time —
       a role that arrives by omission is one nobody chose. */
    if (!isRole(input.role)) throw new Error('Choose a role for this person.');
    return { project: validateProject(value), name, email, role: input.role };
  })
  .handler(async ({ data }) => {
    const { userId: invitedBy, projectId } = await requireMember('admin', data.project);

    const [existing] = await client<
      { id: string }[]
    >`SELECT id FROM "user" WHERE lower(email) = ${data.email}`;
    if (existing) {
      const [already] = await client<{ role: string }[]>`
        SELECT role FROM member
        WHERE project_id = ${projectId} AND user_id = ${existing.id}
      `;
      if (already) throw new Error(`${data.email} is already a member of this project.`);
      await client.begin(async (transaction) => {
        await transaction`
          INSERT INTO member (project_id, user_id, role)
          VALUES (${projectId}, ${existing.id}, ${data.role})
          ON CONFLICT (project_id, user_id) DO NOTHING
        `;
        await fileEvent(transaction, {
          projectId,
          actor: invitedBy,
          type: 'member_added',
          metadata: { email: data.email, role: data.role },
        });
      });
      return { email: data.email, added: true, role: data.role, token: null as string | null };
    }

    const token = `inv_${randomBytes(32).toString('base64url')}`;
    await client.begin(async (transaction) => {
      /* Supersede this project's outstanding link for the address rather
         than collide with the partial unique index. Re-inviting should mean
         "here is a fresh link", not an error about one they never used.

         Scoped, and the index is scoped with it (0009): superseding every live
         invitation for the address would let one project cancel another's,
         which is the same person's invitation to a corpus this admin cannot
         even see. */
      await transaction`
        UPDATE member_invitation SET revoked_at = now()
        WHERE project_id = ${projectId} AND lower(email) = ${data.email}
          AND accepted_at IS NULL AND revoked_at IS NULL
      `;
      await transaction`
        INSERT INTO member_invitation (email, name, token_hash, project_id, role, invited_by, expires_at)
        VALUES (${data.email}, ${data.name}, ${tokenDigest(token)}, ${projectId}, ${data.role},
                ${invitedBy}, now() + ${`${INVITATION_DAYS} days`}::interval)
      `;
      await fileEvent(transaction, {
        projectId,
        actor: invitedBy,
        type: 'member_invited',
        metadata: { email: data.email, role: data.role },
      });
    });

    return { email: data.email, added: false, role: data.role, token: token as string | null };
  });

/* A pending invitation is a live credential to this surface, so it has to be
   visible and cancellable. Expired ones stay listed: knowing a link went unused
   is the difference between chasing someone and reissuing. */
export const listInvitations = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }): Promise<Invitation[]> => {
    const { projectId } = await requireMember('admin', data.project);
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
      WHERE invitation.project_id = ${projectId}
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
  });

export const revokeInvitation = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ invitationId: string }> => {
    const id = (value as { invitationId?: string })?.invitationId?.trim();
    if (!id || !UUID.test(id)) throw new Error('Invalid invitation');
    return { project: validateProject(value), invitationId: id };
  })
  .handler(async ({ data }) => {
    const { userId: revokedBy, projectId } = await requireMember('admin', data.project);
    await client.begin(async (transaction) => {
      const [revoked] = await transaction<{ email: string }[]>`
        UPDATE member_invitation SET revoked_at = now()
        WHERE id = ${data.invitationId} AND project_id = ${projectId}
          AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING email
      `;
      /* Already spent or already revoked. The list reloads without it; there is
         nothing for the administrator to correct. */
      if (!revoked) return;
      await fileEvent(transaction, {
        projectId,
        actor: revokedBy,
        type: 'member_invitation_revoked',
        metadata: { email: revoked.email },
      });
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
      project_id: string;
      project_name: string;
      invited_by: string;
      expired: boolean;
      accepted: boolean;
      revoked: boolean;
    }[]
  >`
    SELECT invitation.id, invitation.email, invitation.name, invitation.role,
           invitation.project_id, project.name AS project_name,
           COALESCE(NULLIF(inviter.name, ''), inviter.email, 'an administrator') AS invited_by,
           invitation.expires_at <= now() AS expired,
           invitation.accepted_at IS NOT NULL AS accepted,
           invitation.revoked_at IS NOT NULL AS revoked
    FROM member_invitation AS invitation
    JOIN projects AS project ON project.id = invitation.project_id
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

/* The two invitation routes are the only unauthenticated server functions in
 * the product, so they are the only ones needing a limiter of their own —
 * everything else is behind `requireMember`, which needs a session, and
 * better-auth limits the endpoints that mint one.
 *
 * **By address, and separately by token**, because neither alone is enough.
 *
 * By token alone is no limit at all against enumeration: every guess is a new
 * key, so every guess gets a fresh allowance.
 *
 * By address alone breaks a real case. With no proxy in front there is no
 * address to tell callers apart — `fallback` is a constant, so *everyone*
 * shares one bucket — and a team of fifteen redeeming their invitations the
 * morning they are sent would see the last five refused. An onboarding flow
 * that fails when onboarding works is not a limiter, it is an outage.
 *
 * So the address bucket is sized for a crowd and the token bucket is sized for
 * a person: enough retries to fix a fumbled password, not enough to sit on one
 * link. Neither is defending the token itself, which is 256 bits and is not
 * going to be guessed — they bound cost and nothing more.
 *
 * Reading is cheap, a digest and one indexed lookup, so it is allowed often.
 * Accepting is the expensive one — it creates an account and better-auth hashes
 * the password — but only ever on a *valid, unclaimed* token, which works
 * exactly once. A junk token is refused before any of that. */
const inviteReads = new FixedWindow({ window: 60, max: 60 });
const inviteAccepts = new FixedWindow({ window: 600, max: 60 });
const inviteAcceptsPerToken = new FixedWindow({ window: 600, max: 10 });

function forwardedIpHeader(): string {
  const configuredHeader = process.env.FORWARDED_IP_HEADER?.trim();
  if (configuredHeader) return configuredHeader;

  return 'x-forwarded-for';
}

function invitationCaller(): string {
  return clientIp((name) => getRequest().headers.get(name) ?? undefined, {
    fallback: 'unproxied',
    forwardedHeader: forwardedIpHeader(),
    trustForwarded: process.env.TRUST_FORWARDED_FOR === 'true',
  });
}

function refuse(retryAfter: number): never {
  throw new Error(`Too many attempts. Wait ${retryAfter} seconds and open the link again.`);
}

function refuseIfTooFast(limiter: FixedWindow): void {
  const decision = limiter.check(invitationCaller());
  if (!decision.ok) refuse(decision.retryAfter);
}

/* Hashed, so a token never becomes a map key held in memory in the clear. The
   same digest the row is stored under, so this costs nothing extra. */
function refuseIfTokenTooFast(token: string): void {
  const decision = inviteAcceptsPerToken.check(createHash('sha256').update(token).digest('hex'));
  if (!decision.ok) refuse(decision.retryAfter);
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
    refuseIfTooFast(inviteReads);
    const invitation = await inspectInvitation(data.token);
    return {
      email: invitation.email,
      name: invitation.name,
      role: isRole(invitation.role) ? invitation.role : ('reader' as Role),
      invitedBy: invitation.invited_by,
      /* Named on the page for the same reason the role is: an instance holds
         several corpora now, and which one you are being let into is the part
         that varies. */
      project: invitation.project_name,
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
    refuseIfTooFast(inviteAccepts);
    refuseIfTokenTooFast(data.token);
    const invitation = await inspectInvitation(data.token);
    const email = invitation.email.toLowerCase();
    const role = isRole(invitation.role) ? invitation.role : ('reader' as Role);

    await client.begin(async (transaction) => {
      /* The one write in `web/src/lib` with no project predicate, and the
         only one that should not have: the row was found by token digest, so
         its project came from the invitation rather than from a caller. */
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
        INSERT INTO member (project_id, user_id, role)
        VALUES (${invitation.project_id}, ${created.id}, ${role})
        ON CONFLICT (project_id, user_id) DO NOTHING
      `;
      await fileEvent(transaction, {
        projectId: invitation.project_id,
        actor: created.id,
        type: 'member_joined',
        metadata: { email: invitation.email, role },
      });
    });

    return { email: invitation.email, role, project: invitation.project_name };
  });

/* A second corpus on one instance.
 *
 * Four things have to happen together, which is why this is a transaction and
 * why `allowUserToCreateOrganization` stays `false` on the plugin: its own
 * `organization/create` endpoint would do the first and leave the rest, giving
 * you a project with no members and no index configuration — reachable by
 * nobody and unable to accept a source.
 *
 * The index configuration is copied from the project you are standing in
 * rather than read from the environment. `concept_chunks.embedding` is
 * `vector(1024)` for the whole table and `EMBEDDING_MODEL` is one process-wide variable, so
 * every project on an instance necessarily shares a model; copying makes that
 * explicit and keeps `index_configuration`'s existing job — refusing a silent
 * model change — working per project.
 *
 * Any signed-in member may start another project. The current project only
 * supplies the instance-wide embedding configuration; it does not delegate
 * authority to create a project. */
export const createProject = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ name: string; slug: string }> => {
    const input = (value ?? {}) as Partial<{ name: string; slug: string }>;
    const name = input.name?.trim();
    if (!name) throw new Error('A project needs a name.');
    if (name.length > 120) throw new Error('That name is too long.');
    const slug = input.slug?.trim().toLowerCase();
    if (!slug || !SLUG.test(slug)) {
      throw new Error('A slug may hold lowercase letters, numbers and single hyphens.');
    }
    if (slug.length > 60) throw new Error('That slug is too long.');
    return { project: validateProject(value), name, slug };
  })
  .handler(async ({ data }) => {
    const { userId: creator, projectId: from } = await requireMember('read', data.project);

    /* Both columns are unique, so both are checked here. Without the name
       check the insert still refuses — with a raw `23505` naming a constraint,
       which is not a sentence to put in front of someone who mistyped. */
    const [taken] = await client<{ slug: string; name: string }[]>`
      SELECT slug, name FROM projects
      WHERE slug = ${data.slug} OR lower(name) = ${data.name.toLowerCase()}
    `;
    if (taken?.slug === data.slug) {
      throw new Error(`The slug “${data.slug}” is already in use.`);
    }
    if (taken) throw new Error(`A project called “${taken.name}” already exists.`);

    let created: string | undefined;
    await client.begin(async (transaction) => {
      const [project] = await transaction<{ id: string }[]>`
        INSERT INTO projects (name, slug) VALUES (${data.name}, ${data.slug})
        RETURNING id
      `;
      if (!project) throw new Error('That project could not be created.');
      created = project.id;
      await transaction`
        INSERT INTO member (project_id, user_id, role)
        VALUES (${project.id}, ${creator}, 'admin')
      `;
      /* `INSERT … SELECT` inserts nothing when the source row is missing, and
         says nothing about it. That cannot happen today — the bootstrap seeds
         `default` and every project since is a copy of one that has a row —
         so the check is here to keep it that way. A project with no index
         configuration would accept sources and lose the one guard that refuses
         a silent model change. */
      const [configured] = await transaction<{ project_id: string }[]>`
        INSERT INTO index_configuration (project_id, embedding_model, embedding_dimensions)
        SELECT ${project.id}, embedding_model, embedding_dimensions
        FROM index_configuration WHERE project_id = ${from}
        RETURNING project_id
      `;
      if (!configured) {
        throw new Error('This project has no index configuration to copy from.');
      }
      /* Filed in the new project's own log, not the one it was created from.
         The custody line of a corpus should start with its creation. */
      await fileEvent(transaction, {
        projectId: project.id,
        actor: creator,
        type: 'project_created',
        metadata: { name: data.name, slug: data.slug },
      });
    });
    if (!created) throw new Error('That project could not be created.');
    return { id: created, name: data.name, slug: data.slug };
  });

/* What this project is, for the Project tab to state.
 *
 * Read-only, and gated at `read` rather than `admin`: nothing here is a
 * credential. The tab that renders it is admin-only, but the facts themselves
 * are the kind a writer wondering why a search missed ought to be able to see,
 * and gating a query harder than its contents need is how a permission stops
 * meaning anything.
 *
 * `index_configuration` is joined rather than left-joined: a project without
 * one cannot accept a source, so its absence is a fault to surface and not a
 * row to render blank. */
export const getProjectFacts = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { projectId } = await requireMember('read', data.project);
    const [row] = await client<
      { slug: string; created_at: string; model: string; dimensions: number }[]
    >`
      SELECT projects.slug, projects.created_at,
             configuration.embedding_model AS model,
             configuration.embedding_dimensions AS dimensions
      FROM projects
      JOIN index_configuration AS configuration ON configuration.project_id = projects.id
      WHERE projects.id = ${projectId}
    `;
    if (!row) throw new Error('This project has no index configuration.');
    return {
      slug: row.slug,
      createdAt: row.created_at,
      model: row.model,
      dimensions: Number(row.dimensions),
    };
  });

/* Renaming a project. The name only — never the slug.
 *
 * The slug is what every link anyone has sent contains, and permanence is the
 * property the URL scheme was chosen for; changing it would break history
 * silently and is a decision that deserves more than a text field. The name is
 * a label: it appears on the plate, in the switcher and on an invitation, and
 * it should be correctable without a migration.
 *
 * This exists because the bootstrap project is called `default`, which nobody
 * chose and which every self-hosted instance now reads on its own rail. */
export const renameProject = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ name: string }> => {
    const name = (value as { name?: string } | undefined)?.name?.trim();
    if (!name) throw new Error('A project needs a name.');
    if (name.length > 120) throw new Error('That name is too long.');
    return { project: validateProject(value), name };
  })
  .handler(async ({ data }) => {
    const { userId: actor, projectId } = await requireMember('admin', data.project);

    /* Same unique column, same courtesy as `createProject` — and excluding
       this project, so re-saving an unchanged name is not an error. */
    const [taken] = await client<{ name: string }[]>`
      SELECT name FROM projects
      WHERE lower(name) = ${data.name.toLowerCase()} AND id <> ${projectId}
    `;
    if (taken) throw new Error(`A project called “${taken.name}” already exists.`);

    await client.begin(async (transaction) => {
      const [before] = await transaction<{ name: string }[]>`
        SELECT name FROM projects WHERE id = ${projectId} FOR UPDATE
      `;
      if (!before) throw new Error('That project no longer exists.');
      if (before.name === data.name) return;
      await transaction`
        UPDATE projects SET name = ${data.name} WHERE id = ${projectId}
      `;
      await fileEvent(transaction, {
        projectId,
        actor,
        type: 'project_renamed',
        metadata: { from: before.name, to: data.name },
      });
    });
    return { name: data.name };
  });

/* Archiving removes a project from normal browser and MCP access without
 * deleting its Git bundle, index, identities, keys, or membership. An
 * administrator can restore it from the archived-projects register. */
export const archiveProject = createServerFn({ method: 'POST' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { userId: actor, projectId } = await requireMember('admin', data.project);
    await client.begin(async (transaction) => {
      const [archived] = await transaction<{ id: string }[]>`
        UPDATE projects SET archived_at = now()
        WHERE id = ${projectId} AND archived_at IS NULL
        RETURNING id
      `;
      if (!archived) throw new Error('That project is no longer available.');
      await fileEvent(transaction, {
        projectId,
        actor,
        type: 'project_archived',
      });
    });
  });

export const restoreProject = createServerFn({ method: 'POST' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { userId: actor, projectId } = await requireArchivedAdmin(data.project);
    await client.begin(async (transaction) => {
      const [restored] = await transaction<{ id: string }[]>`
        UPDATE projects SET archived_at = NULL
        WHERE id = ${projectId} AND archived_at IS NOT NULL
        RETURNING id
      `;
      if (!restored) throw new Error('That project is no longer archived.');
      await fileEvent(transaction, {
        projectId,
        actor,
        type: 'project_restored',
      });
    });
  });

/* Changing your own name and password goes through `authClient.updateUser` and
   `authClient.changePassword` on the client rather than a server function here.
   Both are better-auth's own routes: they run its hooks, re-issue the session,
   and — for the password — verify the current one and revoke other sessions.
   A raw UPDATE against `"user"` would do none of that. */
