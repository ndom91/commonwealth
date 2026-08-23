import type { Sql } from 'postgres';
import { keyPrefix, verifyApiKey } from './auth.js';
import type { Actor, Role } from './domain.js';
import { DomainError } from './errors.js';

type KeyRow = Actor & { secret_hash: string };
type Permission = 'read' | 'write' | 'review' | 'admin';

const permissions: Record<Role, readonly Permission[]> = {
  reader: ['read'],
  writer: ['read', 'write'],
  reviewer: ['read', 'write', 'review'],
  admin: ['read', 'write', 'review', 'admin'],
};

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!permissions[actor.role].includes(permission)) {
    throw new DomainError('Your API key does not have permission for this operation');
  }
}

export class AccessService {
  constructor(private readonly sql: Sql) {}

  async authenticate(key: string): Promise<Actor | null> {
    const keys = await this.sql<KeyRow[]>`
       SELECT users.id, users.project_id AS "projectId", projects.slug AS "projectSlug",
              users.display_name AS name,
              users.role, users.auto_approve AS "autoApprove", api_keys.secret_hash
       FROM api_keys JOIN users ON users.id = api_keys.user_id
        JOIN projects ON projects.id = users.project_id AND projects.archived_at IS NULL
      WHERE api_keys.key_prefix = ${keyPrefix(key)}
        AND api_keys.revoked_at IS NULL AND users.disabled_at IS NULL
    `;
    const match = keys.find((candidate) => verifyApiKey(key, candidate.secret_hash));
    if (!match) return null;
    await this
      .sql`UPDATE api_keys SET last_used_at = now() WHERE secret_hash = ${match.secret_hash}`;
    return {
      id: match.id,
      projectId: match.projectId,
      projectSlug: match.projectSlug,
      name: match.name,
      role: match.role,
      autoApprove: match.autoApprove,
    };
  }
}
