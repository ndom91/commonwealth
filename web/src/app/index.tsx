import { createFileRoute, redirect } from '@tanstack/react-router';
import { getArchivedWorkspaces, getWorkspaces } from '../lib/session.js';

/* The only route that has to decide *which* workspace you meant.
 *
 * Everything else carries the answer in its path. This one picks your oldest
 * membership — for the overwhelmingly common single-workspace instance the only
 * one, and for anyone else a stable choice rather than whichever row the
 * database happened to return first.
 *
 * With no active membership, an archived workspace is still a recovery path;
 * otherwise there is nothing to land on, so it is the same redirect as no
 * session. */
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const [workspaces, archived] = await Promise.all([getWorkspaces(), getArchivedWorkspaces()]);
    const first = workspaces[0];
    throw redirect(
      first
        ? { to: '/w/$slug/sources', params: { slug: first.slug }, search: {} }
        : archived.length > 0
          ? { to: '/archived-workspaces' }
          : { to: '/sign-in' }
    );
  },
  component: () => null,
});
