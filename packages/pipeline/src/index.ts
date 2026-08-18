/* The chunk-and-embed pipeline, shared by the MCP server and the admin app.
 *
 * It exists because both packages write sources, and the one thing they must
 * never disagree on is how text becomes vectors. Two implementations drifting
 * on chunk size, model or dimension would not produce a visible bug — it would
 * silently poison the index, because `PLAN.md` is explicit that embeddings from
 * different models must never share one. Recovering means reindexing every
 * chunk in the database.
 *
 * The boundary is drawn at pure computation on purpose. Nothing here touches
 * Postgres:
 *
 *   - `AGENTS.md` documents that the two packages must write jsonb differently,
 *     because `drizzle()` mutates the serializer of the client it wraps. Shared
 *     SQL would be silently wrong on one side.
 *   - The MCP server's write path is bound to its `Actor` permission model
 *     ("writers may revise only sources they created"), which is not how an
 *     administrator's rights work.
 *
 * So each caller keeps its own SQL and its own event writes, and shares only
 * the part whose divergence corrupts data.
 *
 * Options are passed explicitly rather than as the server's `Config`, so this
 * package needs no validation library and neither caller inherits the other's
 * environment schema — which also keeps it clear of the zod major-version split
 * between the two package manifests.
 *
 * `exports` points at TypeScript source rather than a build output, so there is
 * no compile step to sequence in either Dockerfile. The cost is that consumers
 * must be TypeScript-aware: the MCP server runs under `tsx`, the admin under
 * Vite, and the tests under `node --import tsx`. **Bare `node` cannot import
 * this package** — it resolves the barrel, then fails on `./chunking.js`, which
 * only exists as `.ts`. */

export { type Chunk, chunkMarkdown, embeddingInput } from './chunking.js';
export { EMBEDDING_DIMENSIONS, type EmbeddingOptions, Embeddings } from './embeddings.js';
export {
  type OkfDocument,
  parseOkfDocument,
  serializeOkfDocument,
  validateOkfPath,
} from './okf.js';
