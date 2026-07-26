import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { accessionOf, authoritySeal, SealChip, stamp, stampAt } from '../../components/chrome.js';
import {
  getSourceDetail,
  getSourceEvents,
  getSourceRevisions,
  restoreSource,
  reviseSource,
  setSourceAuthority,
  withdrawSource,
} from '../../lib/knowledge.js';

export const Route = createFileRoute('/sources/$sourceId')({
  component: SourceBench,
});

type Authority = 'unverified' | 'approved' | 'canonical';

type Detail = {
  id: string;
  source_type: 'note' | 'upload';
  status: 'active' | 'deleted' | 'failed';
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

const AUTHORITIES: Authority[] = ['unverified', 'approved', 'canonical'];

function SourceBench() {
  const { sourceId } = Route.useParams();
  const router = useRouter();

  const [detail, setDetail] = useState<Detail>();
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
      const [nextDetail, nextRevisions, nextEvents] = await Promise.all([
        getSourceDetail({ data: { sourceId } }),
        getSourceRevisions({ data: { sourceId } }),
        getSourceEvents({ data: { sourceId } }),
      ]);
      setDetail(nextDetail as unknown as Detail);
      setRevisions(nextRevisions as unknown as Revision[]);
      setEvents(nextEvents as unknown as Event[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This source could not be read.');
    }
  }, [sourceId]);

  useEffect(() => {
    setDetail(undefined);
    void load();
  }, [load]);

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

  return (
    <section className="detail" aria-label="Selected source">
      <div className="bench__head">
        <div>
          <span className="label">
            {detail.source_type} · {accessionOf(detail.id)} · revision {detail.revision_number} ·
            updated {stamp(detail.content_updated_at)}
            {detail.author ? ` · ${detail.author}` : ''}
          </span>
          <h2>{detail.title}</h2>
        </div>
        <div className="bench__seal">
          {withdrawn ? (
            <SealChip state="void">Withdrawn {stamp(detail.deleted_at)}</SealChip>
          ) : detail.is_stale ? (
            <SealChip state="suspended">Stale</SealChip>
          ) : null}
          <SealChip state={authoritySeal(detail.authority)}>{detail.authority}</SealChip>
        </div>
      </div>

      {detail.is_stale && !withdrawn && (
        <p className="bench__consequence">
          Revised {stamp(detail.content_updated_at)}, after it was last verified on{' '}
          {stamp(detail.last_verified_at)}. Agents are being served content no human has vouched
          for.
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
            {detail.last_verified_at
              ? ` · last verified ${stamp(detail.last_verified_at)}`
              : ' · never verified by a human'}
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
                    disabled={pending || withdrawn || current}
                    onClick={() =>
                      void act(
                        () => setSourceAuthority({ data: { sourceId, authority: value } }),
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
          {withdrawn ? (
            <button
              type="button"
              className="btn btn--quiet"
              disabled={pending}
              onClick={() =>
                void act(
                  () => restoreSource({ data: { sourceId } }),
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
                    () => withdrawSource({ data: { sourceId } }),
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
          {!editing && !withdrawn && detail.source_type === 'note' && (
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
                () => reviseSource({ data: { sourceId, title: draftTitle, markdown: draftBody } }),
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
                {stampAt(revision.content_updated_at)} · {revision.content_length} chars
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
                <time dateTime={event.created_at}>{stampAt(event.created_at)}</time>
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
