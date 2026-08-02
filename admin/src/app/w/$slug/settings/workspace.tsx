import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { AppShell, SettingsTabs } from '../../../../components/chrome.js';
import { Stamp } from '../../../../components/stamp.js';
import { readFailure, writeFailure } from '../../../../lib/failure.js';
import { createWorkspace, getWorkspaceFacts, renameWorkspace } from '../../../../lib/management.js';

/* The workspace as an object: what it is called, what it is made of, and how to
 * start another one.
 *
 * These two forms spent a day at the foot of the People register, which was
 * where the only admin page happened to be rather than where they belong. A
 * page about people is not the place to rename a corpus.
 *
 * The facts between them are read-only on purpose. The embedding model is the
 * defining property of a corpus — every chunk in it was produced by that model,
 * and `index_configuration` exists to refuse a silent change — yet until now
 * there was nowhere in the browser to see which one your sources were embedded
 * with. Answering that is not the same as offering to change it: changing it
 * means reindexing every chunk, which is an operator's job with the service
 * stopped, not a select on a settings page. */
export const Route = createFileRoute('/w/$slug/settings/workspace')({
  loader: async ({ params }) => {
    try {
      return {
        facts: await getWorkspaceFacts({ data: { workspace: params.slug } }),
        failure: undefined,
      };
    } catch {
      return { facts: undefined, failure: readFailure('This workspace') };
    }
  },
  component: Workspace,
});

function Workspace() {
  const { slug } = Route.useParams();
  const viewer = Route.useRouteContext();
  const { facts, failure } = Route.useLoaderData();

  return (
    <AppShell
      title="Workspace"
      accession="Settings"
      tabs={<SettingsTabs slug={slug} counts={viewer.counts} role={viewer.role} />}
      {...viewer}
    >
      <section className="detail" aria-label="This workspace">
        <ThisWorkspace />
        <Corpus facts={facts} failure={failure} />
        <NewWorkspace />
      </section>
    </AppShell>
  );
}

/* What this workspace is made of, stated once. Register face throughout: these
   are values a person reads off and quotes back, not prose. */
function Corpus({
  facts,
  failure,
}: {
  facts: { slug: string; createdAt: string; model: string; dimensions: number } | undefined;
  failure: string | undefined;
}) {
  return (
    <div className="bench__section">
      <span className="label">This corpus</span>
      {failure ? (
        <p className="notice" role="alert">
          {failure}
        </p>
      ) : (
        facts && (
          <dl className="facts">
            <div>
              <dt className="label">Slug</dt>
              <dd className="register">{facts.slug}</dd>
            </div>
            <div>
              <dt className="label">Started</dt>
              <dd className="register">
                <Stamp at={facts.createdAt} />
              </dd>
            </div>
            <div>
              <dt className="label">Embedding model</dt>
              <dd className="register">{facts.model}</dd>
            </div>
            <div>
              <dt className="label">Dimensions</dt>
              <dd className="register">{facts.dimensions}</dd>
            </div>
          </dl>
        )
      )}
      <p className="line__caption prose">
        Every chunk in this workspace was embedded by that model, and retrieval only compares
        vectors it produced. One model serves the whole instance; changing it means reindexing every
        source, so it is set by <code>EMBEDDING_MODEL</code> and checked at migration rather than
        offered here.
      </p>
    </div>
  );
}

/* The name on the plate, and the only part of a workspace's identity that can
 * change. The slug cannot: it is in every link anyone has sent, and a URL that
 * quietly stops meaning what it meant is worse than a name nobody likes.
 *
 * Here rather than in Settings for the same reason the people register is —
 * Settings is your own account, this is the cabinet everyone shares. */
function ThisWorkspace() {
  const { slug } = Route.useParams();
  const { workspaceName } = Route.useRouteContext();
  const router = useRouter();
  const [name, setName] = useState(workspaceName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setSaved(false);
    try {
      await renameWorkspace({ data: { workspace: slug, name } });
      /* Invalidating reloads the layout that supplies the rail, so the plate
         and the switcher take the new name without a reload. */
      await router.invalidate();
      setSaved(true);
    } catch (cause) {
      setError(writeFailure(cause, 'That name could not be changed.', 'The name was not changed.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bench__section">
      <span className="label">This workspace</span>
      <form className="bench__inline" onSubmit={submit}>
        <label className={`field${error ? ' field--error' : ''}`}>
          <span className="label">Name</span>
          <input
            required
            value={name}
            disabled={pending}
            onChange={(event) => {
              setSaved(false);
              setName(event.target.value);
            }}
          />
        </label>
        <p className="line__caption">
          Shown on the plate, in everyone's switcher and on any invitation to this workspace. Its
          slug — <span className="register">{slug}</span> — does not change, so links already sent
          keep working.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div className="bench__controls">
          <button className="btn btn--quiet" disabled={pending || name.trim() === workspaceName}>
            {pending ? 'Saving…' : saved ? 'Saved' : 'Save name'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* A second corpus on the same instance — the AI team's notes kept apart from
 * the core team's, one deployment.
 *
 * It lives at the foot of the people register rather than in Settings because
 * it is the same subject: who may reach which cabinet. Settings is your own
 * account. The rail's workspace plate links straight here by hash, so the form
 * is open on arrival — a disclosure that arrived closed would be a dead end.
 *
 * The slug follows the name until the moment you touch it, then it is yours.
 * Deriving it silently forever would mean renaming a workspace could not fix a
 * typo in its URL; making you type it twice for the ordinary case is worse. */
function NewWorkspace() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [wanted, setWanted] = useState('');
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const derived = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const value = edited ? wanted : derived;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const created = await createWorkspace({ data: { workspace: slug, name, slug: value } });
      /* Straight into it. Creating a workspace and then staying in the old one
         would leave you to find the switcher to see what you just made. */
      await navigate({ to: '/w/$slug/sources', params: { slug: created.slug }, search: {} });
    } catch (cause) {
      setError(
        writeFailure(
          cause,
          'That workspace could not be created. Nothing was created.',
          'Nothing was created.'
        )
      );
      setPending(false);
    }
  }

  return (
    <div className="bench__section" id="new-workspace">
      <span className="label">Start another workspace</span>
      <form className="bench__inline" onSubmit={submit}>
        <label className={`field${error ? ' field--error' : ''}`}>
          <span className="label">Name</span>
          <input
            required
            value={name}
            disabled={pending}
            placeholder="AI team"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">Slug</span>
          <input
            required
            className="register"
            value={value}
            disabled={pending}
            /* Mirrors the name placeholder so the pair shows the derivation
               before anyone has typed anything. */
            placeholder="ai-team"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={(event) => {
              setEdited(true);
              setWanted(event.target.value);
            }}
          />
        </label>
        <p className="line__caption">
          Its own sources, its own agent identities, its own activity log — nothing crosses between
          workspaces, and the slug is what everyone will see in the URL. You become its first
          administrator; it starts with the same embedding model as this one, which is the only
          model this instance runs.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div className="bench__controls">
          <button className="btn btn--primary" disabled={pending || !value}>
            {pending ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </form>
    </div>
  );
}
