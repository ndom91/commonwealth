import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { client } from "./db.js";
import { auth, provisioning } from "./auth.js";
import { PAGE_SIZE } from "./knowledge.js";

type Role = "reader" | "writer" | "reviewer" | "admin";
type IdentityInput = { name: string; role: Role; keyLabel: string };
type IdentityAmendment = { name: string; role: Role; description: string | null; autoApprove: boolean };

async function adminId(): Promise<string> {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) throw new Error("Unauthorized");
  const [role] = await client<{ user_id: string }[]>`SELECT user_id FROM admin_role WHERE user_id = ${session.user.id}`;
  if (!role) throw new Error("Forbidden");
  return role.user_id;
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
export const listIdentities = createServerFn({ method: "GET" })
  .validator((value: unknown): { cursor: { createdAt: string; id: string } | null } => {
    const input = (value ?? {}) as { cursor?: { createdAt?: string; id?: string } };
    if (!input.cursor) return { cursor: null };
    if (!input.cursor.createdAt || !input.cursor.id) throw new Error("Invalid cursor");
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

export const createIdentity = createServerFn({ method: "POST" })
  .validator((value: unknown): IdentityInput => {
    const input = value as Partial<IdentityInput>;
    if (!input.name?.trim() || !input.keyLabel?.trim() || !["reader", "writer", "reviewer", "admin"].includes(input.role ?? "")) throw new Error("Invalid identity details");
    return { name: input.name.trim(), keyLabel: input.keyLabel.trim(), role: input.role as IdentityInput["role"] };
  })
  .handler(async ({ data }) => {
    const createdByAdminId = await adminId();
    const secret = `tkb_${randomBytes(32).toString("base64url")}`;
    const salt = randomBytes(16).toString("hex");
    const secretHash = `${salt}:${scryptSync(secret, salt, 32).toString("hex")}`;
    const keyId = randomUUID();
    let identityId: string | undefined;
    await client.begin(async (transaction) => {
      const [identity] = await transaction<{ id: string }[]>`
        INSERT INTO users (workspace_id, display_name, role)
        SELECT id, ${data.name}, ${data.role} FROM workspaces WHERE name = 'default'
        RETURNING id
      `;
      if (!identity) throw new Error("Default workspace is unavailable");
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
    if (!identityId) throw new Error("Unable to create identity");
    return { identityId, key: secret, prefix: secret.slice(0, 12) };
  });

/* Amend a holder's record. Role changes alter what every credential this
   holder owns is permitted to do, so the change is written to the event log
   alongside the values it replaced. */
export const updateIdentity = createServerFn({ method: "POST" })
  .validator((value: unknown): { identityId: string } & IdentityAmendment => {
    const input = value as Partial<{
      identityId: string;
      name: string;
      role: string;
      description: string;
      autoApprove: boolean;
    }>;
    if (!input.identityId?.trim()) throw new Error("Invalid identity");
    if (!input.name?.trim()) throw new Error("A holder name is required");
    if (!["reader", "writer", "reviewer", "admin"].includes(input.role ?? "")) throw new Error("Invalid role");
    if (typeof input.autoApprove !== "boolean") throw new Error("Invalid trusted-holder setting");
    return {
      identityId: input.identityId.trim(),
      name: input.name.trim(),
      role: input.role as IdentityAmendment["role"],
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
      if (!before) throw new Error("That identity no longer exists");
      await transaction`
        UPDATE users
        SET display_name = ${data.name}, role = ${data.role}, description = ${data.description},
            auto_approve = ${data.autoApprove}
        WHERE id = ${data.identityId}
      `;
      /* Values are narrowed to what jsonb can carry rather than `unknown`, so
         the compiler — not a runtime surprise — catches a field that cannot be
         written to the event log. */
      const changed: Record<string, { from: string | boolean | null; to: string | boolean | null }> = {};
      if (before.display_name !== data.name) changed.name = { from: before.display_name, to: data.name };
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
export const setIdentityDisabled = createServerFn({ method: "POST" })
  .validator((value: unknown): { identityId: string; disabled: boolean } => {
    const input = value as Partial<{ identityId: string; disabled: boolean }>;
    if (!input.identityId?.trim()) throw new Error("Invalid identity");
    if (typeof input.disabled !== "boolean") throw new Error("Invalid state");
    return { identityId: input.identityId.trim(), disabled: input.disabled };
  })
  .handler(async ({ data }) => {
    const administrator = await adminId();
    await client.begin(async (transaction) => {
      const [identity] = await transaction<{ workspace_id: string; disabled_at: string | null }[]>`
        SELECT workspace_id, disabled_at FROM users WHERE id = ${data.identityId}
      `;
      if (!identity) throw new Error("That identity no longer exists");
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
          ${data.disabled ? "identity_disabled" : "identity_enabled"},
          ${JSON.stringify({ identityId: data.identityId })}::jsonb)
      `;
    });
    return { identityId: data.identityId, disabled: data.disabled };
  });

/* Issue an additional credential to an existing holder. Rotation is a normal
   custody operation: a holder outlives any one credential, so voiding a key
   must never strand the identity that held it. */
export const issueCredential = createServerFn({ method: "POST" })
  .validator((value: unknown): { identityId: string; keyLabel: string } => {
    const input = value as Partial<{ identityId: string; keyLabel: string }>;
    if (!input.identityId?.trim() || !input.keyLabel?.trim()) throw new Error("Invalid credential details");
    return { identityId: input.identityId.trim(), keyLabel: input.keyLabel.trim() };
  })
  .handler(async ({ data }) => {
    const createdByAdminId = await adminId();
    const secret = `tkb_${randomBytes(32).toString("base64url")}`;
    const salt = randomBytes(16).toString("hex");
    const secretHash = `${salt}:${scryptSync(secret, salt, 32).toString("hex")}`;
    const keyId = randomUUID();
    await client.begin(async (transaction) => {
      const [identity] = await transaction<{ id: string; workspace_id: string }[]>`
        SELECT id, workspace_id FROM users WHERE id = ${data.identityId}
      `;
      if (!identity) throw new Error("That identity no longer exists");
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

export const revokeKey = createServerFn({ method: "POST" })
  .validator((value: unknown): { keyId: string } => {
    const keyId = (value as { keyId?: string }).keyId;
    if (!keyId) throw new Error("Invalid key");
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

/* Administrators — the humans who can reach this surface at all.
 *
 * Distinct from the identities above: those are agent holders in the knowledge
 * schema (`users`, uuid), these are better-auth accounts (`"user"`, text) that
 * hold a row in `admin_role`. The two never mix, which is why the register can
 * show a holder called "Admin" that is nobody's colleague. */
export type Administrator = { id: string; name: string; email: string; createdAt: string; isYou: boolean };

/* Unpaginated on purpose, unlike `listIdentities`. Administrators are people
   with a password to this instance; if that list ever needs a cursor, something
   has gone wrong that pagination would only hide. */
export const listAdministrators = createServerFn({ method: "GET" }).handler(async (): Promise<Administrator[]> => {
  const you = await adminId();
  /* `created_at` comes back as a string, not a Date. `drizzle()` mutates the
     client it is handed (see `db.ts`) and that extends to its date parsers, so
     this client hands back raw Postgres timestamps while a bare postgres.js
     client would give you a Date. Pass it through untouched and let `stampAt`
     format it, which is what every other register here already does. */
  const rows = await client<{ id: string; name: string; email: string; created_at: string }[]>`
    SELECT "user".id, "user".name, "user".email, admin_role.created_at
    FROM admin_role
    JOIN "user" ON "user".id = admin_role.user_id
    ORDER BY admin_role.created_at ASC, "user".email ASC
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
    isYou: row.id === you,
  }));
});

/* Mirrors the bootstrap at `admin/scripts/migrate.ts:81-87`, the only other
   place an administrator is created.
 *
 * Goes through `provisioning` rather than `auth`: `disableSignUp` is enforced
 * inside the sign-up handler, so the request-facing instance refuses this even
 * server-side. See the comment in `auth.ts` for why that is a separate instance
 * rather than a flag flip.
 *
 * The existence check is not only for a nicer message. With `autoSignIn: false`
 * better-auth answers an already-registered email generically, so a duplicate
 * would otherwise look like success. Checking first also lets an existing
 * account be promoted instead of refused. */
export const createAdministrator = createServerFn({ method: "POST" })
  .validator((value: unknown): { name: string; email: string; password: string } => {
    const input = (value ?? {}) as Partial<{ name: string; email: string; password: string }>;
    const email = input.email?.trim().toLowerCase();
    const name = input.name?.trim();
    if (!name) throw new Error("A name is required.");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That does not look like an email address.");
    /* better-auth's own floor is 8; saying so here means the person finds out
       before the account is half-made rather than from a provider error. */
    if (!input.password || input.password.length < 12) {
      throw new Error("Use at least 12 characters for the initial password.");
    }
    return { name, email, password: input.password };
  })
  .handler(async ({ data }) => {
    await adminId();

    const [existing] = await client<{ id: string }[]>`SELECT id FROM "user" WHERE lower(email) = ${data.email}`;
    if (existing) {
      const [already] = await client<{ user_id: string }[]>`
        SELECT user_id FROM admin_role WHERE user_id = ${existing.id}
      `;
      if (already) throw new Error(`${data.email} is already an administrator.`);
      await client`INSERT INTO admin_role (user_id) VALUES (${existing.id}) ON CONFLICT DO NOTHING`;
      return { email: data.email, promoted: true };
    }

    await provisioning.api.signUpEmail({ body: { name: data.name, email: data.email, password: data.password } });
    const [created] = await client<{ id: string }[]>`SELECT id FROM "user" WHERE lower(email) = ${data.email}`;
    if (!created) throw new Error("The account could not be created. Nothing was changed.");
    await client`INSERT INTO admin_role (user_id) VALUES (${created.id}) ON CONFLICT DO NOTHING`;
    return { email: data.email, promoted: false };
  });

/* Changing your own name and password goes through `authClient.updateUser` and
   `authClient.changePassword` on the client rather than a server function here.
   Both are better-auth's own routes: they run its hooks, re-issue the session,
   and — for the password — verify the current one and revoke other sessions.
   A raw UPDATE against `"user"` would do none of that. */
