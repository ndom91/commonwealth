import { createFileRoute, redirect } from '@tanstack/react-router';
import { getArchivedProjects, getProjects } from '../lib/session.js';

/* The only route that has to decide *which* project you meant.
 *
 * Everything else carries the answer in its path. This one picks your oldest
 * membership — for the overwhelmingly common single-project instance the only
 * one, and for anyone else a stable choice rather than whichever row the
 * database happened to return first.
 *
 * With no active membership, an archived project is still a recovery path;
 * otherwise there is nothing to land on, so it is the same redirect as no
 * session. */
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const [projects, archived] = await Promise.all([getProjects(), getArchivedProjects()]);
    const first = projects[0];
    throw redirect(
      first
        ? { to: '/p/$slug/sources', params: { slug: first.slug }, search: {} }
        : archived.length > 0
          ? { to: '/archived-projects' }
          : { to: '/sign-in' }
    );
  },
  component: () => null,
});
