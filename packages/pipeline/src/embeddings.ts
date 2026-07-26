/* Not an option. The dimension is fixed here because the `chunks.embedding`
   column is `vector(1024)` and because a caller free to pass its own number is
   a caller free to disagree with the other one. Changing it means changing the
   migration and reindexing every chunk — see `PLAN.md`. */
export const EMBEDDING_DIMENSIONS = 1024;

export type EmbeddingOptions = {
  ollamaUrl: string;
  model: string;
};

type OllamaEmbeddingResponse = {
  embeddings?: number[][];
  embedding?: number[];
};

export class Embeddings {
  constructor(private readonly options: EmbeddingOptions) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.options.ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.options.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Embedding request failed with ${response.status}`);
    }

    const payload = (await response.json()) as OllamaEmbeddingResponse;
    const embeddings = payload.embeddings ?? (payload.embedding ? [payload.embedding] : undefined);
    if (!embeddings || embeddings.length !== texts.length) {
      throw new Error("Embedding provider returned an invalid response");
    }
    if (embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value)))) {
      throw new Error(`Embedding provider must return ${EMBEDDING_DIMENSIONS} finite values per vector`);
    }

    return embeddings;
  }
}
