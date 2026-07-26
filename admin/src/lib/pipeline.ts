import { Embeddings } from "@llm-team-kb/pipeline";

/* The admin's half of the shared pipeline. Chunking is a pure function and
   needs nothing from here; embedding needs Ollama, which the admin service
   could not reach until this wave added the variables to compose.

   Resolved lazily and cached rather than at module load, so an instance whose
   compose file predates those variables still boots and still curates. Only
   authoring fails, and it fails saying which variable is missing — rather than
   the whole admin surface refusing to start over a feature the operator may
   not use yet. */
let cached: Embeddings | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(
      `${name} is not configured, so this instance cannot re-embed a revision. Add it to the admin service and restart.`,
    );
  }
  return value.trim();
}

export function embeddings(): Embeddings {
  cached ??= new Embeddings({ ollamaUrl: required("OLLAMA_URL"), model: required("EMBEDDING_MODEL") });
  return cached;
}

/* Written to `chunks.embedding_model` on every row. Retrieval mixes chunks from
   whichever model wrote them, so this must be the same value the MCP server
   uses or the index quietly holds two incompatible vector spaces. */
export function embeddingModel(): string {
  return required("EMBEDDING_MODEL");
}
