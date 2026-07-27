import { getRequest } from '@tanstack/react-start/server';
import { auth } from './auth.js';
import { client } from './db.js';
import { can, isRole, type Permission, type Role } from './roles.js';

/* The authorisation gate, kept in its own module for a build reason worth
 * knowing before moving it back.
 *
 * TanStack's server-function split can only strip a module from the client
 * bundle when everything it exports is a server function. `requireMember` is a
 * plain function, so any module exporting it keeps its imports — and those
 * imports are `auth.ts` and `db.ts`, which pull postgres.js, which calls
 * `Buffer.allocUnsafe` at module scope. In a browser that throws
 * `ReferenceError: Buffer is not defined` during import and hydration never
 * runs: every page still renders from SSR and nothing responds to a click.
 *
 * So this file is imported only by `knowledge.ts` and `management.ts`, whose
 * exports are all server functions and which are therefore stripped whole.
 * `session.ts` next door exports server functions only, for the same reason. */

export type Membership = { userId: string; workspaceId: string; role: Role };

export async function readMembership(): Promise<Membership | null> {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) return null;
  /* Wave A has one workspace, so the oldest membership is the only one.
     Ordered rather than an unordered `LIMIT 1` so the answer is stable once
     wave B makes several possible; that ordering is then replaced by
     `session.activeOrganizationId`. */
  const [row] = await client<{ workspace_id: string; role: string }[]>`
    SELECT workspace_id, role FROM member
    WHERE user_id = ${session.user.id}
    ORDER BY created_at ASC
    LIMIT 1
  `;
  if (!row || !isRole(row.role)) return null;
  return { userId: session.user.id, workspaceId: row.workspace_id, role: row.role };
}

/* Every server function that touches the corpus or the people who hold it calls
 * this first, naming the permission it needs.
 *
 * This is the enforcement, and it is the only enforcement. The drawer and the
 * benches hide controls a role cannot use, but that is courtesy — hiding a
 * button does not stop anyone calling the server function behind it, and these
 * are plain HTTP endpoints.
 *
 * Deliberately not routed through the organization plugin's `hasPermission`:
 * its statements describe *its* endpoints (creating members, cancelling
 * invitations), not this product's verbs. `roles.ts` holds the map, mirroring
 * `src/access-service.ts` so people and agents are granted alike. */
export async function requireMember(permission: Permission): Promise<Membership> {
  const membership = await readMembership();
  if (!membership) throw new Error('Unauthorized');
  if (!can(membership.role, permission)) throw new Error(refusal(permission));
  return membership;
}

function refusal(permission: Permission): string {
  if (permission === 'write') return 'Writer access or above is required.';
  if (permission === 'review') return 'Reviewer access or above is required.';
  if (permission === 'admin') return 'Administrator access is required.';
  return 'Membership of this workspace is required.';
}
