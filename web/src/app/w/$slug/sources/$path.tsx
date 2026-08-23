import { createFileRoute, useRouter } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react';
import { authoritySeal, SealChip } from '../../../../components/chrome.js';
import { Stamp } from '../../../../components/stamp.js';
import {
  deprecateConcept,
  getConceptDetail,
  getConceptHistory,
  getConceptVersion,
  reviseConcept,
  verifyConcept,
} from '../../../../lib/concepts.js';
import { writeFailure } from '../../../../lib/failure.js';

export const Route = createFileRoute('/w/$slug/sources/$path')({ component: ConceptBench });

type Authority = 'unverified' | 'approved' | 'canonical';
type Detail = {
  authority: Authority;
  body: string;
  commit_sha: string;
  content_hash: string;
  generated_at: string | null;
  generated_by: string | null;
  last_verified_at: string | null;
  markdown: string;
  path: string;
  tags: string[];
  title: string | null;
  type: string;
};
type History = { commit: string; subject: string; timestamp: string };
type Version = { commit: string; markdown: string };

const AUTHORITIES: Authority[] = ['unverified', 'approved', 'canonical'];
const ConceptDiff = lazy(() =>
  import('../../../../components/concept-diff.js').then(({ ConceptDiff }) => ({
    default: ConceptDiff,
  }))
);

function ConceptBench() {
  const { slug, path } = Route.useParams();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail>();
  const [entries, setEntries] = useState<History[]>([]);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [armDeprecate, setArmDeprecate] = useState(false);
  const [historical, setHistorical] = useState<Version>();
  const [comparing, setComparing] = useState(false);
  const revisionRequest = useRef(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const load = useEffectEvent(async () => {
    setError(undefined);
    try {
      const [next, nextEntries] = await Promise.all([
        getConceptDetail({ data: { workspace: slug, path } }),
        getConceptHistory({ data: { workspace: slug, path } }),
      ]);
      setDetail(next as Detail);
      setEntries(nextEntries as History[]);
      setHistorical(undefined);
      setComparing(false);
    } catch (cause) {
      setError(writeFailure(cause, 'This concept could not be read.'));
    }
  });

  useEffect(() => {
    revisionRequest.current += 1;
    setDetail(undefined);
    void load();
  }, [path]);

  async function act(action: () => Promise<unknown>, failure: string) {
    setPending(true);
    setError(undefined);
    try {
      await action();
      setEditing(false);
      setArmDeprecate(false);
      await load();
      void router.invalidate();
    } catch (cause) {
      setError(writeFailure(cause, failure));
    } finally {
      setPending(false);
    }
  }

  async function showRevision(commit: string) {
    if (commit === detail?.commit_sha) {
      setHistorical(undefined);
      setComparing(false);
      return;
    }
    const request = ++revisionRequest.current;
    setPending(true);
    setError(undefined);
    try {
      const version = (await getConceptVersion({
        data: { workspace: slug, path, commit },
      })) as Version;
      if (request !== revisionRequest.current) return;
      setHistorical(version);
      setComparing(false);
    } catch (cause) {
      setError(writeFailure(cause, 'That revision could not be read.'));
    } finally {
      if (request === revisionRequest.current) setPending(false);
    }
  }

  if (error && !detail) {
    return (
      <section className="detail" aria-label="Selected concept">
        <p className="notice" role="alert">
          {error}
        </p>
      </section>
    );
  }
  if (!detail)
    return (
      <section className="detail" aria-label="Selected concept">
        <p className="empty">Reading concept…</p>
      </section>
    );

  const viewedCommit = historical?.commit ?? detail.commit_sha;
  const historicalView = Boolean(historical);

  return (
    <section className="detail" aria-label="Selected concept">
      <div className="bench__head">
        <div>
          <span className="label">
            {detail.type} · {detail.path} · commit{' '}
            <b className="register">{viewedCommit.slice(0, 12)}</b>
          </span>
          <h2>{detail.title ?? detail.path}</h2>
        </div>
        <div className="bench__seal">
          <SealChip state={authoritySeal(detail.authority)}>{detail.authority}</SealChip>
        </div>
      </div>

      {detail.tags.length > 0 && (
        <div className="tags">
          {detail.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {historicalView && (
        <p className="bench__note">
          Viewing a historical Git revision. It remains in the concept history but is not the
          published retrieval snapshot.
        </p>
      )}

      <div className="bench__section">
        <div className="bench__section-head">
          <span className="label">
            Authority{' '}
            {detail.last_verified_at ? (
              <>
                · last verified <Stamp at={detail.last_verified_at} />
              </>
            ) : (
              '· never verified by a human'
            )}
          </span>
        </div>
        {historicalView ? (
          <button
            className="btn btn--quiet"
            type="button"
            onClick={() => void showRevision(detail.commit_sha)}
          >
            Return to published revision
          </button>
        ) : (
          <div className="authority-set">
            <fieldset className="authority-control">
              <legend className="label">Set authority to</legend>
              <div className="authority-control__choices">
                {AUTHORITIES.map((authority) => (
                  <button
                    key={authority}
                    type="button"
                    className={`btn ${authority === detail.authority ? 'btn--current' : 'btn--quiet'}`}
                    disabled={pending || authority === detail.authority}
                    onClick={() =>
                      void act(
                        () => verifyConcept({ data: { workspace: slug, path, authority } }),
                        'The authority could not be changed.'
                      )
                    }
                  >
                    {authority}
                  </button>
                ))}
              </div>
            </fieldset>
            {armDeprecate ? (
              <>
                <button
                  type="button"
                  className="btn btn--void"
                  disabled={pending}
                  onClick={() =>
                    void act(
                      () => deprecateConcept({ data: { workspace: slug, path } }),
                      'The concept could not be deprecated.'
                    )
                  }
                >
                  {pending ? 'Deprecating…' : 'Confirm deprecate'}
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  disabled={pending}
                  onClick={() => setArmDeprecate(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn--void"
                disabled={pending}
                onClick={() => setArmDeprecate(true)}
              >
                Deprecate
              </button>
            )}
          </div>
        )}
        {!historicalView && armDeprecate && (
          <p className="bench__consequence">
            Deprecating creates a Git commit and removes this concept from the published retrieval
            snapshot. Its Git history remains intact.
          </p>
        )}
      </div>

      <div className="bench__section">
        <div className="bench__section-head">
          <span className="label">
            Content ·{' '}
            {historicalView ? viewedCommit.slice(0, 12) : `${detail.content_hash.slice(0, 12)}…`}
          </span>
          {historicalView && !comparing && (
            <button className="btn btn--quiet" type="button" onClick={() => setComparing(true)}>
              Compare with published
            </button>
          )}
          {historicalView && comparing && (
            <button className="btn btn--quiet" type="button" onClick={() => setComparing(false)}>
              Show revision
            </button>
          )}
          {!historicalView && !editing && (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setTitle(detail.title ?? '');
                setBody(detail.body);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
        </div>
        {comparing && historical ? (
          <Suspense fallback={<p className="empty">Preparing revision comparison…</p>}>
            <ConceptDiff newer={detail.markdown} older={historical.markdown} path={path} />
          </Suspense>
        ) : editing ? (
          <form
            className="revise"
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                () => reviseConcept({ data: { workspace: slug, path, title, markdown: body } }),
                'The revision could not be saved.'
              );
            }}
          >
            <label className="field">
              <span className="label">Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={pending}
                required
              />
            </label>
            <label className="field">
              <span className="label">Markdown</span>
              <textarea
                className="revise__body register"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={pending}
                rows={20}
                spellCheck={false}
                required
              />
            </label>
            <div className="revise__actions">
              <button className="btn btn--primary" disabled={pending}>
                {pending ? 'Saving…' : 'Save revision'}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <pre className="source-body">{historical?.markdown ?? detail.markdown}</pre>
            <p className="line__caption">
              The complete OKF document is shown as text from the{' '}
              {historicalView ? 'selected' : 'indexed'} Git commit.
            </p>
          </>
        )}
      </div>

      <div className="bench__section">
        <span className="label">Git history</span>
        <div className="stubs">
          {entries.map((entry) => (
            <div className="stub" key={entry.commit}>
              <button
                className="stub__revision"
                disabled={pending}
                onClick={() => void showRevision(entry.commit)}
                aria-pressed={entry.commit === viewedCommit}
                type="button"
              >
                <span className="stub__label">{entry.subject}</span>
                <span className="stub__meta register">
                  <b>{entry.commit.slice(0, 12)}</b> ·{' '}
                  <Stamp at={entry.timestamp} precision="datetime" />
                </span>
              </button>
              {entry.commit === detail.commit_sha && (
                <span className="stub__action">
                  <SealChip state="signed">Published</SealChip>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
