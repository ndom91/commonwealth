import { createFileRoute, redirect } from '@tanstack/react-router';

/* The register moved, twice: first to /identities, then under /p/:slug when
   projects became plural. Kept as a redirect rather than deleted — this was
   the post-sign-in landing route for the product's whole life so far, so it is
   in people's history and in links teammates have already sent.

   It cannot know which project was meant, so it defers to `/`, which picks. */
export const Route = createFileRoute('/dashboard')({
  beforeLoad: () => {
    throw redirect({ to: '/', replace: true });
  },
});
