import { redirect } from '@tanstack/react-router';
import { can, type Permission, type Role } from './roles.js';

/* Where a role that cannot open a drawer ends up.
 *
 * Three routes need this — Review, Identities, People — and before this helper
 * each restated the answer, which meant the answer was written down nowhere.
 * It is a product decision, not a formality: a refused reader goes to the
 * *sources* of the workspace they asked for, because the thing they were denied
 * was a section and not the corpus. Sending them to `/` would drop them into
 * whichever workspace happens to be oldest, which is a different refusal.
 *
 * Presentation only, twice over. The rail already omits these drawers for a
 * role that cannot use them, and every server function behind them calls
 * `requireMember` and refuses on its own. This just means a typed URL lands
 * somewhere sensible instead of on a page that would render empty.
 *
 * Not in `authorize.ts`: that module reaches the database and must stay out of
 * the client bundle (see the note at the top of it). This one is pure and
 * client-safe. Not in `roles.ts` either — that file is the vocabulary shared
 * with `mcp-server/src/access-service.ts` by hand, and it should not learn about routing.
 *
 * The parameter is narrowed to the two fields it reads, so any route whose
 * context carries a role and a slug can use it. */
export function requireRole(permission: Permission) {
  return ({ context }: { context: { role: Role; slug: string } }) => {
    if (!can(context.role, permission)) {
      throw redirect({ to: '/w/$slug/sources', params: { slug: context.slug }, search: {} });
    }
  };
}
