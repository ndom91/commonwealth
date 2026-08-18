import { Embeddings } from '@commonwealth/pipeline';

/* The admin's half of the shared pipeline. Chunking is pure; embedding needs
 * Ollama and must use the same model as the MCP service. */
let cached: Embeddings | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(
      `${name} is not configured, so this instance cannot re-embed a revision. Add it to the admin service and restart.`
    );
  }
  return value.trim();
}

export function embeddings(): Embeddings {
  cached ??= new Embeddings({
    ollamaUrl: required('OLLAMA_URL'),
    model: required('EMBEDDING_MODEL'),
  });
  return cached;
}

/* Written to `concept_chunks.embedding_model` on every row. Retrieval mixes
 * chunks from whichever model wrote them, so this must be the same value the MCP
 * server uses or the index quietly holds two incompatible vector spaces. */
export function embeddingModel(): string {
  return required('EMBEDDING_MODEL');
}
