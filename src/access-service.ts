import type { Sql } from "postgres";
import { hashApiKey, keyPrefix, verifyApiKey } from "./auth.js";
import type { Config } from "./config.js";
import type { Actor, Role } from "./domain.js";
import { DomainError } from "./errors.js";
import { EMBEDDING_DIMENSIONS } from "./embeddings.js";
import { runMigrations } from "./migrations.js";

type KeyRow = Actor & { secret_hash: string };
type Permission = "read" | "write" | "review" | "admin";

const permissions: Record<Role, readonly Permission[]> = {
  reader: ["read"],
  writer: ["read", "write"],
  reviewer: ["read", "write", "review"],
  admin: ["read", "write", "review", "admin"],
};

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!permissions[actor.role].includes(permission)) {
    throw new DomainError("Your API key does not have permission for this operation");
  }
}

export class AccessService {
  constructor(
    private readonly sql: Sql,
    private readonly config: Config,
  ) {}

  async bootstrap(): Promise<void> {
    await runMigrations(this.sql);
    const [workspace] = await this.sql<{ id: string }[]>`
      INSERT INTO workspaces (name) VALUES ('default')
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
    if (!workspace) throw new Error("Unable to create default workspace");

    const [indexConfiguration] = await this.sql<{ embedding_model: string; embedding_dimensions: number }[]>`
      SELECT embedding_model, embedding_dimensions FROM index_configuration WHERE workspace_id = ${workspace.id}
    `;
    if (!indexConfiguration) {
      await this.sql`
        INSERT INTO index_configuration (workspace_id, embedding_model, embedding_dimensions)
        VALUES (${workspace.id}, ${this.config.EMBEDDING_MODEL}, ${EMBEDDING_DIMENSIONS})
      `;
    } else if (
      indexConfiguration.embedding_model !== this.config.EMBEDDING_MODEL ||
      indexConfiguration.embedding_dimensions !== EMBEDDING_DIMENSIONS
    ) {
      throw new Error("Embedding model differs from the existing index. Run a full reindex before changing EMBEDDING_MODEL.");
    }

    const [existingKey] = await this.sql`SELECT id FROM api_keys LIMIT 1`;
    if (existingKey) return;

    const [admin] = await this.sql<{ id: string }[]>`
      INSERT INTO users (workspace_id, display_name, role)
      VALUES (${workspace.id}, ${this.config.BOOTSTRAP_ADMIN_NAME}, 'admin')
      RETURNING id
    `;
    if (!admin) throw new Error("Unable to create bootstrap administrator");
    await this.sql`
      INSERT INTO api_keys (user_id, key_prefix, secret_hash)
      VALUES (${admin.id}, ${keyPrefix(this.config.BOOTSTRAP_ADMIN_KEY)}, ${hashApiKey(this.config.BOOTSTRAP_ADMIN_KEY)})
    `;
  }

  async authenticate(key: string): Promise<Actor | null> {
    const keys = await this.sql<KeyRow[]>`
      SELECT users.id, users.workspace_id AS "workspaceId", users.display_name AS name,
             users.role, api_keys.secret_hash
      FROM api_keys JOIN users ON users.id = api_keys.user_id
      WHERE api_keys.key_prefix = ${keyPrefix(key)}
        AND api_keys.revoked_at IS NULL AND users.disabled_at IS NULL
    `;
    const match = keys.find((candidate) => verifyApiKey(key, candidate.secret_hash));
    if (!match) return null;
    await this.sql`UPDATE api_keys SET last_used_at = now() WHERE secret_hash = ${match.secret_hash}`;
    return { id: match.id, workspaceId: match.workspaceId, name: match.name, role: match.role };
  }
}
