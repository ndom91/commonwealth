import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { auth } from './auth.js';
import { client } from './db.js';
import { can, isRole, type Permission, type Role } from './roles.js';

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  return auth.api.getSession({ headers: getRequest().headers });
});

export type Membership = { userId: string; workspaceId: string; role: Role };

async function readMembership(): Promise<Membership | null> {
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

/* What a route needs before it renders: who is signed in, and what they may do.
 *
 * A server function rather than a plain call because `beforeLoad` runs on the
 * client as well as during SSR, and this reads the database. One round trip
 * carries both the display name and the role so the shell can be shaped without
 * a second.
 *
 * `null` means "send them to sign-in" — either there is no session, or there is
 * one with no membership behind it. The second is rare but real: an account
 * whose membership was removed while they were signed in. Treating it as signed
 * out is the honest answer, since there is nothing they can reach. */
export const getViewer = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) return null;
  const membership = await readMembership();
  if (!membership) return null;
  return {
    holder: session.user.name || session.user.email || undefined,
    role: membership.role,
    workspaceId: membership.workspaceId,
  };
});

/* The authorisation gate. Every server function that touches the corpus or the
 * people who hold it calls this first, naming the permission it needs.
 *
 * This is the enforcement, and it is the only enforcement. The drawer and the
 * bench hide controls a role cannot use, but that is courtesy — hiding a button
 * does not stop anyone calling the server function behind it, and these are
 * plain HTTP endpoints.
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
