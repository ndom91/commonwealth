import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { accessionOf, authoritySeal, SealChip } from '../../../../components/chrome.js';
import { Stamp } from '../../../../components/stamp.js';
import {
  getIndexingProgress,
  getSourceDetail,
  getSourceEvents,
  getSourceRevisions,
  restoreSource,
  retryIndexing,
  reviseSource,
  setSourceAuthority,
  withdrawSource,
} from '../../../../lib/knowledge.js';

export const Route = createFileRoute('/w/$slug/sources/$sourceId')({
  component: SourceBench,
});

type Authority = 'unverified' | 'approved' | 'canonical';

type Detail = {
  id: string;
  source_type: 'note' | 'upload';
  status: 'active' | 'indexing' | 'deleted' | 'failed';
  authority: Authority;
  created_at: string;
  deleted_at: string | null;
  last_verified_at: string | null;
  current_content_hash: string;
  title: string;
  revision_number: number;
  markdown_content: string;
  content_updated_at: string;
  original_filename: string | null;
  mime_type: string | null;
  author: string | null;
  tags: string[];
  is_stale: boolean;
};

type Revision = {
  id: string;
  revision_number: number;
  content_hash: string;
  content_updated_at: string;
  created_at: string;
  title: string;
  content_length: number;
  is_current: boolean;
  author: string | null;
};

type Event = {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: string | null;
};

type Progress = { status: string; done: number; total: number; message: string | null };

const AUTHORITIES: Authority[] = ['unverified', 'approved', 'canonical'];

function SourceBench() {
  const { slug } = Route.useParams();
  const { sourceId } = Route.useParams();
  const router = useRouter();

  const [detail, setDetail] = useState<Detail>();
  const [progress, setProgress] = useState<Progress>();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [armWithdraw, setArmWithdraw] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const [nextDetail, nextRevisions, nextEvents, nextProgress] = await Promise.all([
        getSourceDetail({ data: { workspace: slug, sourceId } }),
        getSourceRevisions({ data: { workspace: slug, sourceId } }),
        getSourceEvents({ data: { workspace: slug, sourceId } }),
        /* Fetched on every load, not only while polling: landing directly on a
           source whose indexing failed must show why it failed. */
        getIndexingProgress({ data: { workspace: slug, sourceId } }),
      ]);
      setDetail(nextDetail as unknown as Detail);
      setRevisions(nextRevisions as unknown as Revision[]);
      setEvents(nextEvents as unknown as Event[]);
      setProgress(nextProgress);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This source could not be read.');
    }
  }, [sourceId]);

  useEffect(() => {
    setDetail(undefined);
    setProgress(undefined);
    void load();
  }, [load]);

  /* Indexing happens after the request that created the source has returned, so
     this is the only way the page learns it finished. Polling rather than a
     stream: the whole job is a counter climbing to a known total, one small
     query answers it, and a stream would add a connection to hold open for a
     job that is usually over in seconds.
   *
   * The interval only exists while the source is indexing, and the final tick
   * reloads the bench and the rail so the register and drawer counts catch up
   * with a source that just became active. */
  useEffect(() => {
    if (detail?.status !== 'indexing') return;
    let live = true;
    const tick = async () => {
      let next: Progress;
      try {
        next = await getIndexingProgress({ data: { workspace: slug, sourceId } });
      } catch {
        /* A transient read failure should not tear down a job that is still
           running server-side. The next tick tries again. */
        return;
      }
      if (!live) return;
      setProgress(next);
      if (next.status !== 'indexing') {
        clearInterval(timer);
        await load();
        void router.invalidate();
      }
    };
    /* Once immediately, so the bar starts at the real count rather than sitting
       empty for a second on a source that is already part-way through. */
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [detail?.status, sourceId, load, router]);

  async function act(action: () => Promise<unknown>, failure: string) {
    setPending(true);
    setError(undefined);
    try {
      await action();
      /* Reached only when the action did not throw, so a rejected revision
         leaves the editor open with the text still in it. */
      setArmWithdraw(false);
      setEditing(false);
      await load();
      /* The rail count and the register both reflect authority and status, so
         the whole route reloads rather than just this pane. */
      void router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : failure);
    } finally {
      setPending(false);
    }
  }

  if (error && !detail) {
    return (
      <section className="detail" aria-label="Selected source">
        <p className="notice" role="alert">
          {error}
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="detail" aria-label="Selected source">
        <p className="empty">Reading source…</p>
      </section>
    );
  }

  const withdrawn = detail.status === 'deleted';
  /* Both mean the same thing for the controls below: this source has no
     complete set of chunks, so there is nothing to approve, revise or serve.
     Only the copy differs — one is working, the other stopped. */
  const indexing = detail.status === 'indexing';
  const indexFailed = detail.status === 'failed';
  const unindexed = indexing || indexFailed;

  return (
    <section className="detail" aria-label="Selected source">
      <div className="bench__head">
        <div>
          <span className="label">
            {detail.source_type} · {accessionOf(detail.id)} · revision {detail.revision_number} ·
            updated <Stamp at={detail.content_updated_at} />
            {detail.author ? ` · ${detail.author}` : ''}
          </span>
          <h2>{detail.title}</h2>
        </div>
        <div className="bench__seal">
          {/* Indexing is work in progress, not a seal state — no chip, and no
              oxide. A source part-way through being embedded has not been
              sealed, voided or suspended; it is simply not finished. */}
          {indexing && <span className="label">Indexing</span>}
          {withdrawn ? (
            <SealChip state="void">
              Withdrawn <Stamp at={detail.deleted_at} />
            </SealChip>
          ) : indexFailed ? (
            <SealChip state="suspended">Index failed</SealChip>
          ) : detail.is_stale ? (
            <SealChip state="suspended">Stale</SealChip>
          ) : null}
          <SealChip state={authoritySeal(detail.authority)}>{detail.authority}</SealChip>
        </div>
      </div>

      {indexing && (
        <div className="indexing">
          <div
            className="indexing__rule"
            role="progressbar"
            aria-label="Indexing progress"
            aria-valuemin={0}
            aria-valuemax={progress?.total ?? 0}
            aria-valuenow={progress?.done ?? 0}
          >
            <span
              className="indexing__fill"
              style={{
                width: progress?.total ? `${(progress.done / progress.total) * 100}%` : '0%',
              }}
            />
          </div>
          <p className="bench__consequence" aria-live="polite">
            {progress ? `Indexing ${progress.done} of ${progress.total} chunks. ` : 'Indexing. '}
            Agents cannot find this source until every chunk is embedded. You can leave this page —
            indexing continues without it.
          </p>
        </div>
      )}

      {indexFailed && (
        <p className="bench__consequence">
          Indexing stopped before it finished, so this source is not in the index and no agent can
          find it.
          {/* Messages come from wherever the run broke and are not written to a
              house style — the embedder's end in a URL, Postgres's in a code.
              Punctuate here so the sentence does not run into the next one. */}
          {progress?.message ? ` ${progress.message.replace(/[.!?]?$/, '.')}` : ''} Its text is
          intact — retry below.
        </p>
      )}

      {detail.is_stale && !withdrawn && (
        <p className="bench__consequence">
          Revised <Stamp at={detail.content_updated_at} />, after it was last verified on{' '}
          <Stamp at={detail.last_verified_at} />. Agents are being served content no human has
          vouched for.
        </p>
      )}

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
            Authority
            {detail.last_verified_at ? (
              <>
                {' · last verified '}
                <Stamp at={detail.last_verified_at} />
              </>
            ) : (
              ' · never verified by a human'
            )}
          </span>
          <div className="authority-current">
            <span className="label">Current authority</span>
            <SealChip state={authoritySeal(detail.authority)}>{detail.authority}</SealChip>
          </div>
        </div>
        <div className="authority-set">
          <fieldset className="authority-control">
            <legend className="label">Set authority to</legend>
            <div className="authority-control__choices">
              {AUTHORITIES.map((value) => {
                const current = value === detail.authority;
                return (
                  <button
                    key={value}
                    type="button"
                    className={`btn ${current ? 'btn--current' : 'btn--quiet'}`}
                    aria-pressed={current}
                    /* Authority is a judgement about what agents are served.
                       Nothing is being served until the chunks exist, so there
                       is nothing to pass judgement on yet. */
                    disabled={pending || withdrawn || current || unindexed}
                    onClick={() =>
                      void act(
                        () =>
                          setSourceAuthority({
                            data: { workspace: slug, sourceId, authority: value },
                          }),
                        'The authority could not be changed.'
                      )
                    }
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <span className="authority-set__spacer" />
          {indexFailed && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={pending}
              onClick={() =>
                void act(
                  () => retryIndexing({ data: { workspace: slug, sourceId } }),
                  'Indexing could not be restarted.'
                )
              }
            >
              {pending ? 'Restarting…' : 'Retry indexing'}
            </button>
          )}
          {withdrawn ? (
            <button
              type="button"
              className="btn btn--quiet"
              disabled={pending}
              onClick={() =>
                void act(
                  () => restoreSource({ data: { workspace: slug, sourceId } }),
                  'The source could not be restored.'
                )
              }
            >
              {pending ? 'Restoring…' : 'Restore'}
            </button>
          ) : armWithdraw ? (
            <>
              <button
                type="button"
                className="btn btn--void"
                disabled={pending}
                onClick={() =>
                  void act(
                    () => withdrawSource({ data: { workspace: slug, sourceId } }),
                    'The source could not be withdrawn.'
                  )
                }
              >
                {pending ? 'Withdrawing…' : 'Confirm withdraw'}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={pending}
                onClick={() => setArmWithdraw(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--void" onClick={() => setArmWithdraw(true)}>
              Withdraw
            </button>
          )}
        </div>

        {armWithdraw && !withdrawn && (
          <p className="bench__consequence">
            Withdrawing hides this source from every MCP read immediately. Nothing is destroyed —
            its revisions are kept and it can be restored from here.
          </p>
        )}

        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="bench__section">
        <div className="bench__section-head">
          <span className="label">
            Content · revision {detail.revision_number}
            {detail.original_filename ? ` · ${detail.original_filename}` : ''}
          </span>
          {/* An upload's revision holds text converted from a stored file, so
              editing the text alone would leave the two disagreeing about what
              the source is. The server refuses it; the button does not offer
              it. */}
          {!editing && !withdrawn && !unindexed && detail.source_type === 'note' && (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setDraftTitle(detail.title);
                setDraftBody(detail.markdown_content);
                setError(undefined);
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
                () =>
                  reviseSource({
                    data: { workspace: slug, sourceId, title: draftTitle, markdown: draftBody },
                  }),
                'The revision could not be saved.'
              );
            }}
          >
            <label className="field">
              <span className="label">Title</span>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                disabled={pending}
                required
              />
            </label>
            <label className="field">
              <span className="label">Markdown</span>
              <textarea
                className="revise__body register"
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                disabled={pending}
                rows={20}
                spellCheck={false}
                required
              />
            </label>
            <p className="line__caption">
              Saving writes a new revision rather than overwriting this one — the current text is
              kept and stays readable below. The new text is re-chunked and re-embedded, so agents
              retrieve your wording from the next search onward, and the source counts as verified
              by you.
            </p>
            <div className="revise__actions">
              <button type="submit" className="btn btn--primary" disabled={pending}>
                {pending ? 'Saving…' : 'Save revision'}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setError(undefined);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Rendered as text, never parsed to HTML. This is agent-submitted
                content, and this surface can revoke credentials. */}
            <pre className="source-body">{detail.markdown_content}</pre>
            <p className="line__caption">
              Shown as submitted. Markdown is never rendered here — source content is untrusted
              input, and this surface holds credential controls.
            </p>
          </>
        )}
      </div>

      <div className="bench__section">
        <span className="label">Revisions</span>
        <div className="stubs">
          {revisions.map((revision) => (
            <div className="stub" key={revision.id}>
              <span className="stub__label">
                r{revision.revision_number} · {revision.title}
              </span>
              <span className="stub__meta register">
                <b>{revision.content_hash.slice(0, 12)}…</b> ·{' '}
                <Stamp at={revision.content_updated_at} withTime /> · {revision.content_length}{' '}
                chars
                {revision.author ? ` · ${revision.author}` : ''}
              </span>
              <span className="stub__action">
                {revision.is_current && <SealChip state="signed">Current</SealChip>}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bench__section">
        <span className="label">Custody line</span>
        {events.length === 0 ? (
          <p className="empty">No events recorded for this source.</p>
        ) : (
          <ul className="line register">
            {events.map((event) => (
              <li key={event.id}>
                <Stamp at={event.created_at} withTime />
                <span>
                  {event.event_type}
                  {event.actor ? ` — ${event.actor}` : ''}
                  {event.metadata?.auto ? ' (auto)' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
