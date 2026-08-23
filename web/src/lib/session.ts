import { createServerFn } from '@tanstack/react-start';
import { getCookie, getRequest, setCookie } from '@tanstack/react-start/server';
import { auth } from './auth.js';
import {
  readArchivedProjects,
  readMembership,
  readProjects,
  validateProject,
} from './authorize.js';
import { parseTheme, THEME_COOKIE, THEME_MAX_AGE } from './theme.js';

/* Server functions only. Routes import from here, and this module reaches the
   database through `authorize.ts`, so nothing may be exported whose body the
   client could follow back to it — see the note in `authorize.ts` for what
   happens when something is. */

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  return auth.api.getSession({ headers: getRequest().headers });
});

/* Where an unscoped route sends you: the projects you belong to, oldest
   first. `/` redirects to the first; the switcher lists them all.

   Empty means "sign in" — either there is no session, or there is one with no
   membership behind it. The second is rare but real: an account whose last
   membership was removed while it was signed in. Treating it as signed out is
   the honest answer, since there is nothing it can reach. */
export const getProjects = createServerFn({ method: 'GET' }).handler(async () => {
  return readProjects();
});

export const getArchivedProjects = createServerFn({ method: 'GET' }).handler(async () => {
  return readArchivedProjects();
});

/* Everything the shell needs for one project, in one round trip: who is
   signed in, what they may do *here*, and the other projects the switcher
   offers. `null` when the slug is unknown or they are not a member — the
   layout route turns that into a refusal. */
export const getProjectViewer = createServerFn({ method: 'GET' })
  .validator((value: unknown) => ({ project: validateProject(value) }))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return null;
    /* The id is passed down rather than re-derived. Both of these would
       otherwise read the session again, making three reads of the same cookie
       to answer one question. */
    const membership = await readMembership(data.project, session.user.id);
    if (!membership) return null;
    const projects = await readProjects(session.user.id);
    const current = projects.find((entry) => entry.slug === membership.slug);
    return {
      holder: session.user.name || session.user.email || undefined,
      role: membership.role,
      projectId: membership.projectId,
      slug: membership.slug,
      projectName: current?.name ?? membership.slug,
      projects,
    };
  });

/* Pin a colour scheme for this reader, or read the one they pinned.
 *
 * The cookie is written by the server rather than the browser, which lets it be
 * `httpOnly` — nothing on the client needs to read it, because the scheme in force
 * is already on `<html data-theme>`, put there during SSR. It also keeps the
 * product free of a `document.cookie` write, which the linter rejects and whose
 * modern replacement is still missing in one engine.
 *
 * `undefined` is the answer for a reader who has never touched the toggle, and it
 * has to survive as `undefined` — the stylesheet's `color-scheme: light dark` then
 * defers to the operating system, which is a different outcome from dark. */
export const pinTheme = createServerFn({ method: 'POST' })
  .validator((value: unknown) => {
    const theme = parseTheme((value as { theme?: string })?.theme);
    /* At the framework boundary, so throwing is the contract. A scheme this does
       not recognise is a caller error, not a preference to store. */
    if (!theme) throw new Error('Unknown colour scheme');
    return { theme };
  })
  .handler(async ({ data }) => {
    setCookie(THEME_COOKIE, data.theme, {
      path: '/',
      maxAge: THEME_MAX_AGE,
      sameSite: 'lax',
      httpOnly: true,
    });
  });

export const readTheme = createServerFn({ method: 'GET' }).handler(async () => {
  return parseTheme(getCookie(THEME_COOKIE));
});
