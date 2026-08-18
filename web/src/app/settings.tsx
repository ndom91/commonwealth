import { createFileRoute, redirect } from '@tanstack/react-router';
import { getWorkspaces } from '../lib/session.js';

/* Settings moved under `/w/:slug` when workspaces became plural, and this is
 * the old path kept alive for links already in people's history.
 *
 * It lands on **Account**, not on the workspace settings that now hold this
 * name. Whoever has `/settings` in their history bookmarked the page with their
 * password on it; sending them to a roster of other people instead would be
 * technically the same word and the wrong page.
 *
 * The move was about the frame rather than the content: the page renders the
 * cabinet rail, and a rail with no workspace would have to guess which one to
 * show — reintroducing exactly the ambiguity that putting the slug in the URL
 * removed. Under a workspace you return to the one you left.
 *
 * Same reasoning as `/dashboard`: it cannot know which workspace was meant, so
 * it takes the oldest membership, and no membership means sign in. */
export const Route = createFileRoute('/settings')({
  beforeLoad: async () => {
    const first = (await getWorkspaces())[0];
    throw redirect(
      first
        ? { to: '/w/$slug/account', params: { slug: first.slug }, replace: true }
        : { to: '/sign-in', replace: true }
    );
  },
});
