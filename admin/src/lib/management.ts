import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { client } from "./db.js";
import { auth } from "./auth.js";

type Role = "reader" | "writer" | "reviewer" | "admin";
type IdentityInput = { name: string; role: Role; keyLabel: string };
type IdentityAmendment = { name: string; role: Role; description: string | null };

async function adminId(): Promise<string> {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) throw new Error("Unauthorized");
  const [role] = await client<{ user_id: string }[]>`SELECT user_id FROM admin_role WHERE user_id = ${session.user.id}`;
  if (!role) throw new Error("Forbidden");
  return role.user_id;
}

export const listIdentities = createServerFn({ method: "GET" }).handler(async () => {
  await adminId();
  return client`
    SELECT users.id, users.display_name AS name, users.role, users.created_at, users.description,
      COALESCE(json_agg(json_build_object('id', api_keys.id, 'prefix', api_keys.key_prefix, 'label', managed_api_key.label, 'createdAt', api_keys.created_at, 'lastUsedAt', api_keys.last_used_at, 'revokedAt', api_keys.revoked_at)
        ORDER BY api_keys.created_at DESC) FILTER (WHERE api_keys.id IS NOT NULL), '[]') AS keys
    FROM users
    LEFT JOIN api_keys ON api_keys.user_id = users.id
    LEFT JOIN managed_api_key ON managed_api_key.id = api_keys.id
    GROUP BY users.id
    ORDER BY users.created_at DESC
  `;
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
        INSERT INTO events (workspace_id, event_type, metadata)
        SELECT id, 'api_key_created', ${JSON.stringify({ identityId: identity.id, keyId, label: data.keyLabel })}::jsonb
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
    const input = value as Partial<{ identityId: string; name: string; role: string; description: string }>;
    if (!input.identityId?.trim()) throw new Error("Invalid identity");
    if (!input.name?.trim()) throw new Error("A holder name is required");
    if (!["reader", "writer", "reviewer", "admin"].includes(input.role ?? "")) throw new Error("Invalid role");
    return {
      identityId: input.identityId.trim(),
      name: input.name.trim(),
      role: input.role as IdentityAmendment["role"],
      description: input.description?.trim() || null,
    };
  })
  .handler(async ({ data }) => {
    await adminId();
    await client.begin(async (transaction) => {
      const [before] = await transaction<
        { workspace_id: string; display_name: string; role: string; description: string | null }[]
      >`
        SELECT workspace_id, display_name, role, description FROM users WHERE id = ${data.identityId}
      `;
      if (!before) throw new Error("That identity no longer exists");
      await transaction`
        UPDATE users
        SET display_name = ${data.name}, role = ${data.role}, description = ${data.description}
        WHERE id = ${data.identityId}
      `;
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      if (before.display_name !== data.name) changed.name = { from: before.display_name, to: data.name };
      if (before.role !== data.role) changed.role = { from: before.role, to: data.role };
      if ((before.description ?? null) !== data.description)
        changed.description = { from: before.description, to: data.description };
      if (Object.keys(changed).length > 0) {
        await transaction`
          INSERT INTO events (workspace_id, event_type, metadata)
          VALUES (${before.workspace_id}, 'identity_amended',
            ${JSON.stringify({ identityId: data.identityId, changed })}::jsonb)
        `;
      }
    });
    return { identityId: data.identityId };
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
        INSERT INTO events (workspace_id, event_type, metadata)
        VALUES (${identity.workspace_id}, 'api_key_created',
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
    await adminId();
    await client`UPDATE api_keys SET revoked_at = now() WHERE id = ${data.keyId} AND revoked_at IS NULL`;
    return { revoked: true };
  });
