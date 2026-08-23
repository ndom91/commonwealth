import { createFileRoute, redirect } from '@tanstack/react-router';
import { getProjects } from '../lib/session.js';

/* Settings moved under `/p/:slug` when projects became plural, and this is
 * the old path kept alive for links already in people's history.
 *
 * It lands on **Account**, not on the project settings that now hold this
 * name. Whoever has `/settings` in their history bookmarked the page with their
 * password on it; sending them to a roster of other people instead would be
 * technically the same word and the wrong page.
 *
 * The move was about the frame rather than the content: the page renders the
 * cabinet rail, and a rail with no project would have to guess which one to
 * show — reintroducing exactly the ambiguity that putting the slug in the URL
 * removed. Under a project you return to the one you left.
 *
 * Same reasoning as `/dashboard`: it cannot know which project was meant, so
 * it takes the oldest membership, and no membership means sign in. */
export const Route = createFileRoute('/settings')({
  beforeLoad: async () => {
    const first = (await getProjects())[0];
    throw redirect(
      first
        ? { to: '/p/$slug/account', params: { slug: first.slug }, replace: true }
        : { to: '/sign-in', replace: true }
    );
  },
});
