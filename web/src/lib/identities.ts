import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { createServerFn } from '@tanstack/react-start';
import { requireMember, type Scoped, validateProject } from './authorize.js';
import { PAGE_SIZE } from './concepts.js';
import { client } from './db.js';
import { fileEvent } from './events.js';
import { can, canGrant, type Role } from './roles.js';

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
