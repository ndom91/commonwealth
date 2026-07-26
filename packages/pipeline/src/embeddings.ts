/* Not an option. The dimension is fixed here because the `chunks.embedding`
   column is `vector(1024)` and because a caller free to pass its own number is
   a caller free to disagree with the other one. Changing it means changing the
   migration and reindexing every chunk — see `PLAN.md`. */
export const EMBEDDING_DIMENSIONS = 1024;

export type EmbeddingOptions = {
  ollamaUrl: string;
  model: string;
};

/* Chunks per request. Embedding cost is linear in chunk count — roughly 0.7s
   each for qwen3-embedding:0.6b on CPU — so a single request carrying every
   chunk of a document made the deadline below depend on document size. A note
   embedded in a second; a converted PDF of fifty chunks blew a thirty-second
   timeout and reported "aborted due to timeout" with no clue which of the two
   network calls had failed.
 *
 * Batching bounds the work behind one deadline instead of leaving it open. At
 * sixteen a batch takes about eleven seconds, comfortably inside the timeout on
 * slow hardware.
 *
 * Batches run in sequence, not in parallel: Ollama here is CPU-bound, so
 * concurrent requests would contend for the same cores and push each one closer
 * to its own deadline rather than finishing sooner. */
const BATCH_SIZE = 16;

type OllamaEmbeddingResponse = {
  embeddings?: number[][];
  embedding?: number[];
};

export class Embeddings {
  constructor(private readonly options: EmbeddingOptions) {}

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      vectors.push(...(await this.embedBatch(texts.slice(start, start + BATCH_SIZE))));
    }
    return vectors;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    /* A bare AbortError reads "The operation was aborted due to timeout" and
       names neither the service nor the stage, which is useless when a request
       makes two long network calls in sequence. Say which one gave up. */
    const response = await fetch(`${this.options.ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.options.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    }).catch((cause: unknown) => {
      if (cause instanceof Error && cause.name === 'TimeoutError') {
        throw new Error(
          `Embedding ${texts.length} chunk(s) with ${this.options.model} timed out after 30s. The model may be loading, or the host may be slow.`
        );
      }
      throw new Error(`Could not reach the embedding service at ${this.options.ollamaUrl}`, {
        cause,
      });
    });

    if (!response.ok) {
      throw new Error(`Embedding request failed with ${response.status}`);
    }

    const payload = (await response.json()) as OllamaEmbeddingResponse;
    const embeddings = payload.embeddings ?? (payload.embedding ? [payload.embedding] : undefined);
    if (!embeddings || embeddings.length !== texts.length) {
      throw new Error('Embedding provider returned an invalid response');
    }
    if (
      embeddings.some(
        (embedding) =>
          embedding.length !== EMBEDDING_DIMENSIONS ||
          embedding.some((value) => !Number.isFinite(value))
      )
    ) {
      throw new Error(
        `Embedding provider must return ${EMBEDDING_DIMENSIONS} finite values per vector`
      );
    }

    return embeddings;
  }
}
