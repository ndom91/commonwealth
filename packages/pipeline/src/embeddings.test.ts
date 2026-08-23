import assert from 'node:assert/strict';
import test from 'node:test';
import { EMBEDDING_DIMENSIONS, Embeddings } from './embeddings.js';

function vector(value: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);
}

test('uses the OpenAI embedding endpoint and restores response order', async () => {
  const originalFetch = globalThis.fetch;
  let url = '';
  let body = '';
  globalThis.fetch = (async (input, init) => {
    url = String(input);
    body = String(init?.body);
    return new Response(
      JSON.stringify({
        data: [
          { index: 1, embedding: vector(2) },
          { index: 0, embedding: vector(1) },
        ],
      })
    );
  }) as typeof fetch;

  try {
    const embeddings = new Embeddings({
      embeddingUrl: 'http://inference:8080/',
      model: 'qwen3-embedding-test',
    });

    assert.deepEqual(await embeddings.embed(['first', 'second']), [vector(1), vector(2)]);
    assert.equal(url, 'http://inference:8080/v1/embeddings');
    assert.deepEqual(JSON.parse(body), {
      model: 'qwen3-embedding-test',
      input: ['first', 'second'],
      encoding_format: 'float',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects an invalid OpenAI embedding response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }))) as typeof fetch;

  try {
    const embeddings = new Embeddings({
      embeddingUrl: 'http://inference:8080',
      model: 'qwen3-embedding-test',
    });

    await assert.rejects(() => embeddings.embed(['first']), /1024 finite values/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prefixes asymmetric-model queries without changing document inputs', async () => {
  const originalFetch = globalThis.fetch;
  const inputs: string[][] = [];
  globalThis.fetch = (async (_input, init) => {
    inputs.push((JSON.parse(String(init?.body)) as { input: string[] }).input);
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: vector(1) }] }));
  }) as typeof fetch;

  try {
    const embeddings = new Embeddings({
      embeddingUrl: 'http://inference:8080',
      model: 'qwen3-embedding-test',
      queryInstruction: 'Retrieve relevant knowledge.',
    });

    await embeddings.embed(['document']);
    await embeddings.embedQuery('question');

    assert.deepEqual(inputs, [
      ['document'],
      ['Instruct: Retrieve relevant knowledge.\nQuery: question'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
