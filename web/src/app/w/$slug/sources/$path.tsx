import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useState } from 'react';
import { authoritySeal, SealChip } from '../../../../components/chrome.js';
import { Stamp } from '../../../../components/stamp.js';
import {
  deprecateConcept,
  getConceptDetail,
  getConceptHistory,
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

const AUTHORITIES: Authority[] = ['unverified', 'approved', 'canonical'];

function ConceptBench() {
  const { slug, path } = Route.useParams();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail>();
  const [entries, setEntries] = useState<History[]>([]);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [armDeprecate, setArmDeprecate] = useState(false);
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
    } catch (cause) {
      setError(writeFailure(cause, 'This concept could not be read.'));
    }
  });

  useEffect(() => {
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

  return (
    <section className="detail" aria-label="Selected concept">
      <div className="bench__head">
        <div>
          <span className="label">
            {detail.type} · {detail.path} · commit{' '}
            <b className="register">{detail.commit_sha.slice(0, 12)}</b>
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
        {armDeprecate && (
          <p className="bench__consequence">
            Deprecating creates a Git commit and removes this concept from the published retrieval
            snapshot. Its Git history remains intact.
          </p>
        )}
      </div>

      <div className="bench__section">
        <div className="bench__section-head">
          <span className="label">Content · {detail.content_hash.slice(0, 12)}…</span>
          {!editing && (
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
        {editing ? (
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
            <pre className="source-body">{detail.markdown}</pre>
            <p className="line__caption">
              The complete OKF document is shown as text from the indexed Git commit.
            </p>
          </>
        )}
      </div>

      <div className="bench__section">
        <span className="label">Git history</span>
        <div className="stubs">
          {entries.map((entry) => (
            <div className="stub" key={entry.commit}>
              <span className="stub__label">{entry.subject}</span>
              <span className="stub__meta register">
                <b>{entry.commit.slice(0, 12)}</b> ·{' '}
                <Stamp at={entry.timestamp} precision="datetime" />
              </span>
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
