import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { auth } from './auth.js';
import { readMembership } from './authorize.js';

/* Server functions only. Routes import from here, so every export has to be
   something TanStack's split can strip from the client bundle — see the note in
   `authorize.ts` for what happens when one is not. */

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  return auth.api.getSession({ headers: getRequest().headers });
});

/* What a route needs before it renders: who is signed in, and what they may do.
 *
 * One round trip carries both the display name and the role so the shell can be
 * shaped without a second.
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
