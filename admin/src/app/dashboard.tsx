import { createFileRoute, redirect } from "@tanstack/react-router";

/* The register moved to /identities, which is what the rail has always called
   it. Kept as a redirect rather than deleted: this was the post-sign-in landing
   route for the product's whole life so far, so it is in people's history and
   in any link a teammate has already sent. */
export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/identities", replace: true });
  },
});
