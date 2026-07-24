import type { Config } from "./config.js";

export const EMBEDDING_DIMENSIONS = 1024;

type OllamaEmbeddingResponse = {
  embeddings?: number[][];
  embedding?: number[];
};

export class Embeddings {
  constructor(private readonly config: Config) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.config.OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.config.EMBEDDING_MODEL, input: texts }),
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
