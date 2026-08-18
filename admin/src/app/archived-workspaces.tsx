import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { restoreWorkspace } from '../lib/management.js';
import { getArchivedWorkspaces, getSession } from '../lib/session.js';

export const Route = createFileRoute('/archived-workspaces')({
  beforeLoad: async () => {
    if (!(await getSession())) throw redirect({ to: '/sign-in' });
  },
  loader: () => getArchivedWorkspaces(),
  component: ArchivedWorkspaces,
});

type ArchivedWorkspace = {
  id: string;
  name: string;
  slug: string;
  role: string;
  archivedAt: string;
};

function ArchivedWorkspaces() {
  const router = useRouter();
  const workspaces = Route.useLoaderData() as ArchivedWorkspace[];

  return (
    <main className="intake">
      <div className="intake__form">
        <span className="label">Workspace archive</span>
        <h1>Archived workspaces</h1>
        {workspaces.length === 0 ? (
          <p className="prose">You have no archived workspaces.</p>
        ) : (
          <ul className="index__list">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <RestoreWorkspace
                  workspace={workspace}
                  onRestored={() => void router.invalidate()}
                />
              </li>
            ))}
          </ul>
        )}
        <Link to="/" className="btn btn--quiet">
          Back to workspaces
        </Link>
      </div>
    </main>
  );
}

function RestoreWorkspace({
  workspace,
  onRestored,
}: {
  workspace: ArchivedWorkspace;
  onRestored: () => void;
}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function restore() {
    setPending(true);
    setError(undefined);
    try {
      await restoreWorkspace({ data: { workspace: workspace.slug } });
      onRestored();
      await navigate({ to: '/w/$slug/sources', params: { slug: workspace.slug }, search: {} });
    } catch {
      setError('That workspace could not be restored. Nothing was changed.');
      setPending(false);
    }
  }

  return (
    <div className="bench__section">
      <span className="label">{workspace.role}</span>
      <h2>{workspace.name}</h2>
      <p className="line__caption register">{workspace.slug}</p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn--primary"
        disabled={pending}
        onClick={() => void restore()}
      >
        {pending ? 'Restoring…' : 'Restore workspace'}
      </button>
    </div>
  );
}
