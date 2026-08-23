import { useQueryClient } from '@tanstack/react-query';
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
import { projectQueryKey } from '../../../../lib/queries.js';

export const Route = createFileRoute('/p/$slug/sources/$path')({ component: ConceptBench });

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
type Version = Pick<Detail, 'authority' | 'last_verified_at' | 'tags' | 'title' | 'type'> & {
  commit: string;
  markdown: string;
};

const AUTHORITIES: Authority[] = ['unverified', 'approved', 'canonical'];
const AUTHORITY_ACTIONS: Record<Authority, string> = {
  unverified: 'Unverify',
  approved: 'Approve',
  canonical: 'Mark canonical',
};
const ConceptDiff = lazy(() =>
  import('../../../../components/concept-diff.js').then(({ ConceptDiff }) => ({
    default: ConceptDiff,
  }))
);

function ConceptBench() {
  const { slug, path } = Route.useParams();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail>();
  const [entries, setEntries] = useState<History[]>([]);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [armDeprecate, setArmDeprecate] = useState(false);
  const [historical, setHistorical] = useState<Version>();
  const [historicalContent, setHistoricalContent] = useState<'body' | 'diff'>('body');
  const [comparison, setComparison] = useState<Version>();
  const [preparingComparison, setPreparingComparison] = useState(false);
  const revisionRequest = useRef(0);
  const comparisonRequest = useRef(0);
  const bodyTab = useRef<HTMLButtonElement>(null);
  const diffTab = useRef<HTMLButtonElement>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const load = useEffectEvent(async () => {
    comparisonRequest.current += 1;
    setComparison(undefined);
    setPreparingComparison(false);
    setError(undefined);
    try {
      const [next, nextEntries] = await Promise.all([
        getConceptDetail({ data: { project: slug, path } }),
        getConceptHistory({ data: { project: slug, path } }),
      ]);
      setDetail(next as Detail);
      setEntries(nextEntries as History[]);
      setHistorical(undefined);
      setHistoricalContent('body');
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
      await queryClient.invalidateQueries({ queryKey: projectQueryKey(slug) });
      await load();
      void router.invalidate();
    } catch (cause) {
      setError(writeFailure(cause, failure));
    } finally {
      setPending(false);
    }
  }

  async function showRevision(commit: string) {
    const request = ++revisionRequest.current;
    comparisonRequest.current += 1;
    setComparison(undefined);
    setPreparingComparison(false);
    if (commit === detail?.commit_sha || commit === entries[0]?.commit) {
      setHistorical(undefined);
      setHistoricalContent('body');
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const version = (await getConceptVersion({
        data: { project: slug, path, commit },
      })) as Version;
      if (request !== revisionRequest.current) return;
      setHistorical(version);
      setHistoricalContent('body');
    } catch (cause) {
      setError(writeFailure(cause, 'That revision could not be read.'));
    } finally {
      if (request === revisionRequest.current) setPending(false);
    }
  }

  function previousRevision(commit: string) {
    const index = entries.findIndex((entry) => entry.commit === commit);
    if (index >= 0) return entries[index + 1];
    return commit === detail?.commit_sha ? entries[1] : undefined;
  }

  async function showDiff() {
    const commit = historical?.commit ?? detail?.commit_sha;
    if (!commit) return;
    const previous = previousRevision(commit);
    if (!previous) return;

    setHistoricalContent('diff');
    if (comparison?.commit === previous.commit) return;

    const request = ++comparisonRequest.current;
    setPreparingComparison(true);
    setError(undefined);
    try {
      const version = (await getConceptVersion({
        data: { project: slug, path, commit: previous.commit },
      })) as Version;
      if (request !== comparisonRequest.current) return;
      setComparison(version);
    } catch (cause) {
      if (request === comparisonRequest.current) {
        setError(writeFailure(cause, 'The preceding revision could not be read.'));
      }
    } finally {
      if (request === comparisonRequest.current) setPreparingComparison(false);
    }
  }

  function switchHistoricalContent(event: React.KeyboardEvent<HTMLButtonElement>) {
    const next =
      event.key === 'ArrowLeft' || event.key === 'Home'
        ? 'body'
        : event.key === 'ArrowRight' || event.key === 'End'
          ? 'diff'
          : undefined;
    if (!next) return;
    event.preventDefault();
    if (next === 'diff') void showDiff();
    else setHistoricalContent(next);
    (next === 'body' ? bodyTab : diffTab).current?.focus();
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
  const viewed = historical ?? detail;
  const hasDiff = Boolean(previousRevision(viewedCommit));
  const sourceBody = (
    <>
      <pre className="source-body">{historical?.markdown ?? detail.markdown}</pre>
      <div className="source-body__footer">
        <p className="line__caption">
          The complete OKF document is shown as text from the{' '}
          {historicalView ? 'selected' : 'indexed'} Git commit.
        </p>
        <span className="label">
          Content ·{' '}
          {historicalView ? viewedCommit.slice(0, 12) : `${detail.content_hash.slice(0, 12)}…`}
        </span>
      </div>
    </>
  );

  return (
    <section className="detail" aria-label="Selected concept">
      <div className="bench__head">
        <div>
          <span className="label">
            {viewed.type} · {detail.path} · commit{' '}
            <b className="register">{viewedCommit.slice(0, 12)}</b>
          </span>
          <h2>{viewed.title ?? detail.path}</h2>
        </div>
        <div className="bench__seal">
          <SealChip state={authoritySeal(viewed.authority)}>{viewed.authority}</SealChip>
        </div>
      </div>

      {viewed.tags.length > 0 && (
        <div className="tags">
          {viewed.tags.map((tag) => (
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
        <div className="authority-layout">
          <div className="authority-summary">
            <div className="authority-summary__head">
              <span className="label">Authority</span>
            </div>
            <div className="authority-summary__standing">
              <span className="authority-summary__value">{viewed.authority}</span>
              <span className="register authority-summary__verified">
                {viewed.last_verified_at ? (
                  <>
                    Last verified <Stamp at={viewed.last_verified_at} />
                  </>
                ) : (
                  'Never verified by a human'
                )}
              </span>
            </div>
            {!historicalView && (
              <fieldset className="authority-control">
                <legend className="label">Change authority</legend>
                <div className="authority-control__choices">
                  {AUTHORITIES.map((authority) => (
                    <button
                      key={authority}
                      type="button"
                      className={`btn ${authority === detail.authority ? 'btn--current' : 'btn--quiet'}`}
                      disabled={pending || authority === detail.authority}
                      onClick={() =>
                        void act(
                          () => verifyConcept({ data: { project: slug, path, authority } }),
                          'The authority could not be changed.'
                        )
                      }
                    >
                      {authority === detail.authority ? authority : AUTHORITY_ACTIONS[authority]}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="authority-actions authority-actions--operations">
              {historicalView ? (
                <button
                  className="btn btn--quiet"
                  type="button"
                  onClick={() => void showRevision(detail.commit_sha)}
                >
                  Back to latest
                </button>
              ) : armDeprecate ? (
                <>
                  <button
                    type="button"
                    className="btn btn--void"
                    disabled={pending}
                    onClick={() =>
                      void act(
                        () => deprecateConcept({ data: { project: slug, path } }),
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
              {!historicalView && !editing && (
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => {
                    setTitle(detail.title ?? '');
                    setBody(detail.body);
                    setHistoricalContent('body');
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
              )}
            </div>
          </div>
          {hasDiff && !editing && (
            <div className="content-tabs" role="tablist" aria-label="Concept content">
              <button
                ref={bodyTab}
                className="content-tabs__tab"
                id="concept-content-body-tab"
                type="button"
                role="tab"
                aria-controls="concept-content-body-panel"
                aria-selected={historicalContent === 'body'}
                tabIndex={historicalContent === 'body' ? 0 : -1}
                onClick={() => setHistoricalContent('body')}
                onKeyDown={switchHistoricalContent}
              >
                Content
              </button>
              <button
                ref={diffTab}
                className="content-tabs__tab"
                id="concept-content-diff-tab"
                type="button"
                role="tab"
                aria-controls="concept-content-diff-panel"
                aria-selected={historicalContent === 'diff'}
                tabIndex={historicalContent === 'diff' ? 0 : -1}
                onClick={() => void showDiff()}
                onKeyDown={switchHistoricalContent}
              >
                Diff
              </button>
            </div>
          )}
        </div>
        {!historicalView && armDeprecate && (
          <p className="bench__consequence">
            Deprecating creates a Git commit and removes this concept from the published retrieval
            snapshot. Its Git history remains intact.
          </p>
        )}
      </div>

      <div className="bench__section">
        {hasDiff && historicalContent === 'diff' ? (
          <div
            id="concept-content-diff-panel"
            role="tabpanel"
            aria-labelledby="concept-content-diff-tab"
          >
            {comparison ? (
              <Suspense fallback={<p className="empty">Preparing revision comparison…</p>}>
                <ConceptDiff newer={viewed.markdown} older={comparison.markdown} path={path} />
              </Suspense>
            ) : preparingComparison ? (
              <p className="empty">Preparing revision comparison…</p>
            ) : null}
          </div>
        ) : editing ? (
          <form
            className="revise"
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                () => reviseConcept({ data: { project: slug, path, title, markdown: body } }),
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
        ) : hasDiff ? (
          <div
            id="concept-content-body-panel"
            role="tabpanel"
            aria-labelledby="concept-content-body-tab"
          >
            {sourceBody}
          </div>
        ) : (
          sourceBody
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
                aria-pressed={!historicalView && entry === entries[0]}
                type="button"
              >
                <span className="stub__label">{entry.subject}</span>
                <span className="stub__meta register">
                  <b>{entry.commit.slice(0, 12)}</b> ·{' '}
                  <Stamp at={entry.timestamp} precision="datetime" />
                </span>
              </button>
              {entry === entries[0] && (
                <span className="stub__action">
                  <SealChip state="signed">Latest</SealChip>
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
