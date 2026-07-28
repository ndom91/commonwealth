import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { auth } from './auth.js';
import { readMembership, readWorkspaces, validateWorkspace } from './authorize.js';

/* Server functions only. Routes import from here, and this module reaches the
   database through `authorize.ts`, so nothing may be exported whose body the
   client could follow back to it — see the note in `authorize.ts` for what
   happens when something is. */

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  return auth.api.getSession({ headers: getRequest().headers });
});

/* Where an unscoped route sends you: the workspaces you belong to, oldest
   first. `/` redirects to the first; the switcher lists them all.

   Empty means "sign in" — either there is no session, or there is one with no
   membership behind it. The second is rare but real: an account whose last
   membership was removed while it was signed in. Treating it as signed out is
   the honest answer, since there is nothing it can reach. */
export const getWorkspaces = createServerFn({ method: 'GET' }).handler(async () => {
  return readWorkspaces();
});

/* Everything the shell needs for one workspace, in one round trip: who is
   signed in, what they may do *here*, and the other workspaces the switcher
   offers. `null` when the slug is unknown or they are not a member — the
   layout route turns that into a refusal. */
export const getWorkspaceViewer = createServerFn({ method: 'GET' })
  .validator((value: unknown) => ({ workspace: validateWorkspace(value) }))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return null;
    const membership = await readMembership(data.workspace);
    if (!membership) return null;
    const workspaces = await readWorkspaces();
    const current = workspaces.find((entry) => entry.slug === membership.slug);
    return {
      holder: session.user.name || session.user.email || undefined,
      role: membership.role,
      workspaceId: membership.workspaceId,
      slug: membership.slug,
      workspaceName: current?.name ?? membership.slug,
      workspaces,
    };
  });
