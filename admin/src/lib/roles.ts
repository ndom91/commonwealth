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

/* What each role is called and what it may do, in one place, so the invite form
   and the people register describe them identically. */
export const ROLE_SUMMARY: Record<Role, string> = {
  reader: 'Browse and search sources',
  writer: 'Add and revise their own sources',
  reviewer: 'Approve sources and revise anyone’s',
  admin: 'Everything, including people and credentials',
};
