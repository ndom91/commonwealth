import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { createSource } from "../../lib/knowledge.js";

export const Route = createFileRoute("/sources/new")({
  component: NewSource,
});

function NewSource() {
  const router = useRouter();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const result = await createSource({
        data: { title, markdown: body, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) },
      });
      await router.invalidate();
      await navigate({ to: "/sources/$sourceId", params: { sourceId: result.sourceId }, search: {} });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? `${cause.message} Nothing was written — adjust it and try again.`
          : "The source could not be created. Nothing was written — try again.",
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
            <h2>Write a note</h2>
          </div>
        </div>

        <div className="bench__section revise">
          <label className={`field${error ? " field--error" : ""}`}>
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

          <label className="field">
            <span className="label">Tags</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="deploys, staging — comma separated"
            />
          </label>

          <p className="line__caption">
            Written by you, so it lands approved and verified rather than queuing
            for review — the queue is for text nobody has vouched for. Marking it
            canonical stays a separate decision.
          </p>

          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}

          <div className="bench__controls">
            <button className="btn btn--primary" disabled={pending}>
              {pending ? "Writing…" : "Create source"}
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              disabled={pending}
              onClick={() => void navigate({ to: "/sources", search: {} })}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
