import { createFileRoute, Link, notFound, Outlet, redirect } from '@tanstack/react-router';
import { getSession, getWorkspaceViewer } from '../../lib/session.js';

/* The workspace layout: everything under `/w/:slug` is one corpus.
 *
 * The slug in the URL is the scope, and this is where it is turned into one.
 * Resolving it here rather than in each route means a section cannot forget:
 * a new page under this path is scoped before it has any code of its own.
 *
 * It is *not* the enforcement. Every server function the children call takes
 * the same slug and re-checks it through `requireMember` — see `authorize.ts`.
 * This layout only decides what to render; the server decides what to answer.
 *
 * A slug that does not exist and one you are not a member of get the same
 * refusal, word for word. Telling them apart would confirm which workspaces
 * exist on the instance to someone who cannot enter any of them.
 *
 * It refuses rather than bouncing you to a workspace you *can* see. A silent
 * redirect would answer a different question than the one the URL asked, and
 * the reader would have no way to tell a link they mistyped from one they have
 * lost access to. Signing out is the exception: with no session there is
 * nothing to refuse yet, so that goes to the door. */
export const Route = createFileRoute('/w/$slug')({
  beforeLoad: async ({ params }) => {
    const viewer = await getWorkspaceViewer({ data: { workspace: params.slug } });
    if (viewer) return viewer;
    if (!(await getSession())) throw redirect({ to: '/sign-in' });
    throw notFound();
  },
  notFoundComponent: Unavailable,
  component: () => <Outlet />,
});

function Unavailable() {
  return (
    <main className="intake">
      <span className="intake__plate">Team knowledge base</span>
      <div className="intake__form">
        <div>
          <span className="label">Not on your card</span>
          <p className="prose">
            That workspace is not available to you. It may not exist, or you may not be a member of
            it — an administrator of that workspace can add you.
          </p>
        </div>
        <div className="intake__foot">
          <Link to="/" className="btn btn--primary">
            Back to your workspaces
          </Link>
        </div>
      </div>
    </main>
  );
}
