import { createFileRoute, redirect } from '@tanstack/react-router';
import { getWorkspaces } from '../lib/session.js';

/* Settings moved under `/w/:slug` when workspaces became plural, and this is
 * the old path kept alive for links already in people's history.
 *
 * It is your account, not a corpus, so the move is about the frame rather than
 * the content: the page renders the cabinet rail, and a rail with no workspace
 * would have to guess which one to show — reintroducing exactly the ambiguity
 * putting the slug in the URL removed. Under a workspace you return to the one
 * you left.
 *
 * Same reasoning as `/dashboard`: it cannot know which workspace was meant, so
 * it takes the oldest membership, and no membership means sign in. */
export const Route = createFileRoute('/settings')({
  beforeLoad: async () => {
    const first = (await getWorkspaces())[0];
    throw redirect(
      first
        ? { to: '/w/$slug/settings', params: { slug: first.slug }, replace: true }
        : { to: '/sign-in', replace: true }
    );
  },
});
