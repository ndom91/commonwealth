import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { client } from "./db.js";
import { auth } from "./auth.js";

type IdentityInput = { name: string; role: "reader" | "writer" | "reviewer" | "admin"; keyLabel: string };

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
    SELECT users.id, users.display_name AS name, users.role, users.created_at,
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
