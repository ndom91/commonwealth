import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { authoritySeal, SealChip } from '../../../../components/chrome.js';
import { inspectRetrieval } from '../../../../lib/concepts.js';
import { writeFailure } from '../../../../lib/failure.js';

export const Route = createFileRoute('/w/$slug/sources/inspect')({ component: RetrievalInspector });

type Result = {
  authority: 'unverified' | 'approved' | 'canonical';
  commit: string;
  excerpt: string;
  heading: string | null;
  path: string;
  scores: { finalScore: number; keywordScore: number; semanticScore: number };
  tags: string[];
  title: string | null;
  type: string;
};

function RetrievalInspector() {
  const { slug } = Route.useParams();
  const [results, setResults] = useState<Result[]>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function inspect(form: HTMLFormElement) {
    const data = new FormData(form);
    const tags = String(data.get('tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    setPending(true);
    setError(undefined);
    setResults(undefined);
    try {
      setResults(
        (await inspectRetrieval({
          data: {
            authority: String(data.get('authority') ?? '') || undefined,
            limit: Number(data.get('limit')),
            query: String(data.get('query') ?? ''),
            tags,
            type: String(data.get('type') ?? '') || undefined,
            workspace: slug,
          },
        })) as Result[]
      );
    } catch (cause) {
      setError(writeFailure(cause, 'Retrieval could not be inspected.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="detail" aria-label="Retrieval inspector">
      <div className="bench__head">
        <div>
          <span className="label">Published retrieval snapshot</span>
          <h2>Retrieval inspector</h2>
        </div>
      </div>
      <p className="bench__note">
        This runs the same ranked retrieval as MCP{' '}
        <code className="register">search_knowledge</code>. Inspecting does not count as an agent
        retrieval in the custody log.
      </p>
      <form
        className="retrieval-form"
        onSubmit={(event) => {
          event.preventDefault();
          void inspect(event.currentTarget);
        }}
      >
        <label className="field retrieval-form__query">
          <span className="label">Question</span>
          <input name="query" required placeholder="What should an agent know?" />
        </label>
        <label className="field">
          <span className="label">Authority</span>
          <select defaultValue="" name="authority">
            <option value="">All</option>
            <option value="unverified">Unverified</option>
            <option value="approved">Approved</option>
            <option value="canonical">Canonical</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Type</span>
          <input name="type" placeholder="Playbook" />
        </label>
        <label className="field">
          <span className="label">Tags</span>
          <input name="tags" placeholder="operations, workers" />
        </label>
        <label className="field retrieval-form__limit">
          <span className="label">Results</span>
          <input defaultValue="5" max="20" min="1" name="limit" required type="number" />
        </label>
        <button className="btn btn--primary" disabled={pending}>
          {pending ? 'Inspecting…' : 'Inspect retrieval'}
        </button>
      </form>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {results && results.length === 0 && (
        <p className="empty">No published passage matched this query.</p>
      )}
      {results && results.length > 0 && (
        <>
          <p className="line__caption">
            Chunks are nominated by semantic and keyword rank, then ordered by reciprocal-rank
            fusion. Scores are ranking signals, not confidence percentages.
          </p>
          <ol className="retrieval-results">
            {results.map((result, index) => (
              <li key={`${result.path}-${result.commit}-${index}`}>
                <div className="retrieval-results__head">
                  <span className="register">{String(index + 1).padStart(2, '0')}</span>
                  <Link
                    params={{ path: result.path, slug }}
                    search={{}}
                    to="/w/$slug/sources/$path"
                  >
                    {result.title ?? result.path}
                  </Link>
                  <SealChip state={authoritySeal(result.authority)}>{result.authority}</SealChip>
                </div>
                <p className="retrieval-results__meta register">
                  {result.type} · {result.path} · {result.heading ?? 'Unheaded passage'} ·{' '}
                  {result.commit.slice(0, 12)}
                </p>
                <pre className="retrieval-results__excerpt">{result.excerpt}</pre>
                <dl className="retrieval-results__scores register">
                  <div>
                    <dt>Semantic</dt>
                    <dd>{result.scores.semanticScore.toFixed(4)}</dd>
                  </div>
                  <div>
                    <dt>Keyword</dt>
                    <dd>{result.scores.keywordScore.toFixed(4)}</dd>
                  </div>
                  <div>
                    <dt>Final</dt>
                    <dd>{result.scores.finalScore.toFixed(4)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
