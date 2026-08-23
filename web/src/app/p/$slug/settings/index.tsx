import { createFileRoute, redirect } from '@tanstack/react-router';

/* A tab bar has no "no tab selected" state, so the section itself is not a
   place — it forwards to the first tab. Replaces rather than pushes, so Back
   from the Project tab leaves Settings instead of bouncing through here. */
export const Route = createFileRoute('/p/$slug/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/p/$slug/settings/project',
      params: { slug: params.slug },
      replace: true,
    });
  },
});
