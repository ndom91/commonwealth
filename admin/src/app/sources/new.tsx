import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { createSource, uploadSource } from '../../lib/knowledge.js';

export const Route = createFileRoute('/sources/new')({
  component: NewSource,
});

/* Two ways in, one bench. A note is typed; a document is converted by MarkItDown
   and its original kept, addressed by content hash. They are presented as one
   screen with a mode rather than two routes, because the decision is "what am I
   holding" — not a different task. */
type Mode = 'note' | 'upload';

function NewSource() {
  const router = useRouter();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [file, setFile] = useState<File>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      let result: { sourceId: string };
      if (mode === 'upload') {
        if (!file) throw new Error('Choose a document to upload.');
        /* FormData rather than base64: a 10 MB document would otherwise become
           a 13 MB string held on both sides of the request. */
        const payload = new FormData();
        payload.set('file', file);
        payload.set('title', title);
        payload.set('tags', tags);
        result = await uploadSource({ data: payload });
      } else {
        result = await createSource({
          data: {
            title,
            markdown: body,
            tags: tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
          },
        });
      }
      await router.invalidate();
      await navigate({
        to: '/sources/$sourceId',
        params: { sourceId: result.sourceId },
        search: {},
      });
    } catch (cause) {
      /* No longer promises "nothing was written": the request now covers the
         write, and indexing continues after it returns. A failure here really
         did write nothing — but a failure *after* this point lands on the
         source's own page as a retry, so the blanket claim no longer holds and
         should not be made twice in two different places. */
      setError(
        cause instanceof Error && cause.message
          ? `${cause.message} Adjust it and try again.`
          : 'The source could not be created. Try again.'
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="detail" aria-label="New source">
      <form onSubmit={submit}>
        <div className="bench__head">
          <div>
            <span className="label">New source</span>
            <h2>{mode === 'upload' ? 'Upload a document' : 'Write a note'}</h2>
          </div>
          <div className="bench__seal">
            {(['note', 'upload'] as Mode[]).map((value) => (
              <button
                key={value}
                type="button"
                className={`btn ${mode === value ? 'btn--current' : 'btn--quiet'}`}
                disabled={pending}
                onClick={() => {
                  setMode(value);
                  setError(undefined);
                }}
              >
                {value === 'note' ? 'Write' : 'Upload'}
              </button>
            ))}
          </div>
        </div>

        <div className="bench__section revise">
          <label className={`field${error ? ' field--error' : ''}`}>
            <span className="label">Title</span>
            <input
              required
              autoFocus
              aria-invalid={error ? true : undefined}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="How staging deploys work"
            />
          </label>

          {mode === 'upload' ? (
            <label className="field">
              <span className="label">Document</span>
              <input
                required
                type="file"
                accept=".pdf,.docx,.pptx,.xlsx,.csv,.html,.md,.txt"
                disabled={pending}
                onChange={(event) => setFile(event.target.files?.[0])}
              />
            </label>
          ) : (
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
                placeholder="# Heading&#10;&#10;What an agent should know, and where it came from."
              />
            </label>
          )}

          <label className="field">
            <span className="label">Tags</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="deploys, staging — comma separated"
            />
          </label>

          <p className="line__caption">
            {mode === 'upload'
              ? 'The document is converted to Markdown for indexing and the original is kept, addressed by its content hash. Indexing a long document takes a few minutes and carries on after you leave the page — agents cannot find it until it finishes. Uploads cannot be edited as text afterwards — replace the file instead.'
              : 'Written by you, so it lands approved and verified rather than queuing for review — the queue is for text nobody has vouched for. Marking it canonical stays a separate decision.'}
          </p>

          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}

          <div className="bench__controls">
            <button className="btn btn--primary" disabled={pending}>
              {pending
                ? mode === 'upload'
                  ? 'Converting…'
                  : 'Writing…'
                : mode === 'upload'
                  ? 'Upload document'
                  : 'Create source'}
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              disabled={pending}
              onClick={() => void navigate({ to: '/sources', search: {} })}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
