import { createFileRoute, redirect } from '@tanstack/react-router';
import { getWorkspaces } from '../lib/session.js';

/* The only route that has to decide *which* workspace you meant.
 *
 * Everything else carries the answer in its path. This one picks your oldest
 * membership — for the overwhelmingly common single-workspace instance the only
 * one, and for anyone else a stable choice rather than whichever row the
 * database happened to return first.
 *
 * No membership means signed out in every way that matters: there is nothing to
 * land on, so it is the same redirect as no session. */
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const workspaces = await getWorkspaces();
    const first = workspaces[0];
    throw redirect(
      first
        ? { to: '/w/$slug/sources', params: { slug: first.slug }, search: {} }
        : { to: '/sign-in' }
    );
  },
  component: () => null,
});
