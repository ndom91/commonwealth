import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { createConcept } from '../../../../lib/concepts.js';
import { writeFailure } from '../../../../lib/failure.js';
import { conceptQueryKey } from '../../../../lib/queries.js';

export const Route = createFileRoute('/p/$slug/sources/new')({ component: NewConcept });

function NewConcept() {
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const [path, setPath] = useState('notes/');
  const [type, setType] = useState('Note');
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [tags, setTags] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const result = await createConcept({
        data: {
          project: slug,
          path,
          type,
          title,
          markdown,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
      });
      await queryClient.invalidateQueries({ queryKey: conceptQueryKey(slug) });
      await router.invalidate();
      await navigate({
        to: '/p/$slug/sources/$path',
        params: { slug, path: result.path },
        search: {},
      });
    } catch (cause) {
      setError(
        writeFailure(
          cause,
          'The concept could not be created. Try again.',
          'Adjust it and try again.'
        )
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="detail" aria-label="New concept">
      <form onSubmit={submit}>
        <div className="bench__head">
          <div>
            <span className="label">New concept</span>
            <h2>Write an OKF concept</h2>
          </div>
        </div>
        <div className="bench__section revise">
          <label className="field">
            <span className="label">Bundle path</span>
            <input
              required
              autoFocus
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="playbooks/restart-worker.md"
            />
          </label>
          <label className="field">
            <span className="label">Type</span>
            <input
              required
              value={type}
              onChange={(event) => setType(event.target.value)}
              placeholder="Playbook"
            />
          </label>
          <label className="field">
            <span className="label">Title</span>
            <input required value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field">
            <span className="label">Markdown</span>
            <textarea
              className="revise__body register"
              required
              rows={20}
              spellCheck={false}
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">Tags</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="operations, worker"
            />
          </label>
          <p className="line__caption">
            Saving creates an OKF Markdown document, commits it to this project bundle, and
            publishes that commit as the retrieval snapshot.
          </p>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <div className="bench__controls">
            <button className="btn btn--primary" disabled={pending}>
              {pending ? 'Publishing…' : 'Create concept'}
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              disabled={pending}
              onClick={() => void navigate({ to: '/p/$slug/sources', search: {} })}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
