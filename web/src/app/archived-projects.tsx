import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { restoreProject } from '../lib/management.js';
import { getArchivedProjects, getSession } from '../lib/session.js';

export const Route = createFileRoute('/archived-projects')({
  beforeLoad: async () => {
    if (!(await getSession())) throw redirect({ to: '/sign-in' });
  },
  loader: () => getArchivedProjects(),
  component: ArchivedProjects,
});

type ArchivedProject = {
  id: string;
  name: string;
  slug: string;
  role: string;
  archivedAt: string;
};

function ArchivedProjects() {
  const router = useRouter();
  const projects = Route.useLoaderData() as ArchivedProject[];

  return (
    <main className="intake">
      <div className="intake__form">
        <span className="label">Project archive</span>
        <h1>Archived projects</h1>
        {projects.length === 0 ? (
          <p className="prose">You have no archived projects.</p>
        ) : (
          <ul className="index__list">
            {projects.map((project) => (
              <li key={project.id}>
                <RestoreProject project={project} onRestored={() => void router.invalidate()} />
              </li>
            ))}
          </ul>
        )}
        <Link to="/" className="btn btn--quiet">
          Back to projects
        </Link>
      </div>
    </main>
  );
}

function RestoreProject({
  project,
  onRestored,
}: {
  project: ArchivedProject;
  onRestored: () => void;
}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function restore() {
    setPending(true);
    setError(undefined);
    try {
      await restoreProject({ data: { project: project.slug } });
      onRestored();
      await navigate({ to: '/p/$slug/sources', params: { slug: project.slug }, search: {} });
    } catch {
      setError('That project could not be restored. Nothing was changed.');
      setPending(false);
    }
  }

  return (
    <div className="bench__section">
      <span className="label">{project.role}</span>
      <h2>{project.name}</h2>
      <p className="line__caption register">{project.slug}</p>
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
        {pending ? 'Restoring…' : 'Restore project'}
      </button>
    </div>
  );
}
