/* The role vocabulary, shared by people and agents.
 *
 * `src/access-service.ts` already grants agents `read | write | review | admin`
 * through the roles `reader | writer | reviewer | admin`. Humans signing in to
 * the browser get the same four, deliberately: two vocabularies for the same
 * four powers would be a permanent source of "does writer mean the same thing
 * here?".
 *
 * This module is the browser-side copy of that map. It cannot import the MCP
 * server's — they are separate packages with separate deploy units — so the two
 * are kept identical by hand and by the comment on each side.
 *
 * No `owner`. better-auth's organization plugin defaults to
 * `owner | admin | member`, which would be a third vocabulary; `creatorRole` in
 * `auth.ts` points its bootstrap at `admin` instead. */

export const ROLES = ['reader', 'writer', 'reviewer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type Permission = 'read' | 'write' | 'review' | 'admin';

const permissions: Record<Role, readonly Permission[]> = {
  reader: ['read'],
  writer: ['read', 'write'],
  reviewer: ['read', 'write', 'review'],
  admin: ['read', 'write', 'review', 'admin'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return permissions[role].includes(permission);
}

/* Whether someone holding `granter` may mint a holder at `candidate` — nobody
   may issue a credential that can do more than they can.
 *
 * Stated as a subset of permissions rather than a position in `ROLES`. The four
 * names happen to be listed in increasing power and an index comparison would
 * work today, but that array is also what the role `<select>` iterates, so
 * reordering it for the sake of a form would silently turn this check into the
 * wrong one. A subset check cannot be broken by rearranging a list. */
export function canGrant(granter: Role, candidate: Role): boolean {
  return permissions[candidate].every((permission) => can(granter, permission));
}

/* A project as the chrome needs to know it: enough to name it on the plate,
 * link to it from the switcher, and cut the rail to what you may do in it.
 *
 * It lives here for a boundary reason rather than a taxonomic one. It is
 * *produced* by `readProjects` in `authorize.ts` and *consumed* by `AppShell`,
 * and it used to be declared in both. Collapsing it into `authorize.ts` would
 * mean a client component importing from the one module whose header warns at
 * length that reaching it from the browser kills hydration — safe only while
 * every such import keeps its `type` keyword, and silent when one does not.
 * This module is already imported by both sides and has no server reach at all,
 * so there is nothing to get wrong. */
export type ProjectRef = { id: string; name: string; slug: string; role: Role };

/* What each role is called and what it may do, in one place, so the invite form
   and the people register describe them identically. */
export const ROLE_SUMMARY: Record<Role, string> = {
  reader: 'Browse and search sources',
  writer: 'Add and revise their own sources',
  reviewer: 'Approve sources and revise anyone’s',
  admin: 'Everything, including people and credentials',
};
