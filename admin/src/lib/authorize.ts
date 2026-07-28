import { getRequest } from '@tanstack/react-start/server';
import { auth } from './auth.js';
import { client } from './db.js';
import { can, isRole, type Permission, type Role } from './roles.js';

/* The authorisation gate, kept in its own module for a build reason worth
 * knowing before moving it back.
 *
 * TanStack's split replaces each server function with an RPC stub, and the rest
 * of the module is then tree-shaken. An export that *reaches* a server-only
 * import survives that shake and drags the import with it. `requireMember` is
 * such an export: a plain function whose body touches `auth.ts` and `db.ts`,
 * which pull postgres.js, which calls `Buffer.allocUnsafe` at module scope. In
 * a browser that throws `ReferenceError: Buffer is not defined` during import
 * and hydration never runs — every page still renders from SSR and nothing
 * responds to a click. It has happened once already.
 *
 * A plain *data* export is fine, because it reaches nothing: `knowledge.ts`
 * exports `PAGE_SIZE` and its client module is still free of `db.js`. The line
 * is what the export touches, not whether it is a server function.
 *
 * So this file, whose every export reaches the database, is imported only by
 * `knowledge.ts`, `management.ts` and `session.ts` — modules whose own exports
 * are all server functions or plain data, and which are therefore stripped. */

export type Membership = { userId: string; workspaceId: string; slug: string; role: Role };

/* Slugs are the URL segment, so they are shape-checked before reaching SQL and
   the same expression validates one on the way in at `createWorkspace`. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function signedInUser(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  return session?.user.id ?? null;
}

/* Membership in one named workspace.
 *
 * Resolving the slug and checking membership are a single query on purpose.
 * Two queries — "does this workspace exist" then "am I in it" — invite a caller
 * to be told which slugs are real, and invite a future edit to use the
 * workspace from the first without the answer from the second. */
export async function readMembership(slug: string): Promise<Membership | null> {
  const userId = await signedInUser();
  if (!userId || !SLUG.test(slug)) return null;
  const [row] = await client<{ workspace_id: string; role: string }[]>`
    SELECT member.workspace_id, member.role
    FROM member
    JOIN workspaces ON workspaces.id = member.workspace_id
    WHERE member.user_id = ${userId} AND workspaces.slug = ${slug}
  `;
  if (!row || !isRole(row.role)) return null;
  return { userId, workspaceId: row.workspace_id, slug, role: row.role };
}

export type WorkspaceRef = { id: string; name: string; slug: string; role: Role };

/* Every workspace the caller belongs to, oldest membership first — which makes
   the first entry the one `/` lands on and the order the switcher lists. */
export async function readWorkspaces(): Promise<WorkspaceRef[]> {
  const userId = await signedInUser();
  if (!userId) return [];
  const rows = await client<{ id: string; name: string; slug: string; role: string }[]>`
    SELECT workspaces.id, workspaces.name, workspaces.slug, member.role
    FROM member
    JOIN workspaces ON workspaces.id = member.workspace_id
    WHERE member.user_id = ${userId}
    ORDER BY member.created_at ASC, workspaces.name ASC
  `;
  return rows
    .filter((row) => isRole(row.role))
    .map((row) => ({ id: row.id, name: row.name, slug: row.slug, role: row.role as Role }));
}

/* The gate. Every server function that touches a workspace's contents calls
 * this first, naming the permission it needs *and the workspace it is acting
 * in* — which the caller supplies from the URL.
 *
 * Taking the workspace as an argument rather than inferring it is the whole
 * security model of this wave. A gate that only asked "are you a member of
 * something" would let a member of one workspace hand a server function another
 * workspace's source id; because authorisation and scope come from this one
 * lookup, the id and the permission are always about the same workspace.
 *
 * This is also the only enforcement. The drawer and the benches hide controls a
 * role cannot use, but that is courtesy — these are plain HTTP endpoints and
 * hiding a button does not stop anyone calling the function behind it.
 *
 * Deliberately not routed through the organization plugin's `hasPermission`:
 * its statements describe *its* endpoints (creating members, cancelling
 * invitations), not this product's verbs. `roles.ts` holds the map, mirroring
 * `src/access-service.ts` so people and agents are granted alike. */
export async function requireMember(permission: Permission, slug: string): Promise<Membership> {
  const membership = await readMembership(slug);
  /* One sentence for "no session", "no such workspace" and "not a member of
     it". The last two are the same fact from the caller's side, and telling
     them apart would confirm which slugs exist to someone who cannot enter. */
  if (!membership) throw new Error('That workspace is not available to you.');
  if (!can(membership.role, permission)) throw new Error(refusal(permission));
  return membership;
}

function refusal(permission: Permission): string {
  if (permission === 'write') return 'Writer access or above is required.';
  if (permission === 'review') return 'Reviewer access or above is required.';
  if (permission === 'admin') return 'Administrator access is required.';
  return 'Membership of this workspace is required.';
}

/* Server-function validators all need the workspace out of the payload, and all
   need to reject the same shapes. */
export function validateWorkspace(value: unknown): string {
  const slug = (value as { workspace?: string } | undefined)?.workspace?.trim();
  if (!slug || !SLUG.test(slug)) throw new Error('Invalid workspace');
  return slug;
}

/* The payload shape of a scoped server function, and the validator for one that
   takes nothing else. Both live here rather than in `knowledge.ts` and
   `management.ts` because they belong to the gate, not to either subject — and
   because two identical copies is how the two drift. */
export type Scoped<T> = T & { workspace: string };

export function validateScope(value: unknown): { workspace: string } {
  return { workspace: validateWorkspace(value) };
}
