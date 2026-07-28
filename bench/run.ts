/* A number for retrieval quality, so tuning it stops being an argument.
 *
 * `PLAN.md` describes a much heavier evaluation — throughput, RAM, image size,
 * cold start — as the gate for calling a model a *release default*. This is not
 * that. It answers one question, "is search finding the right passage", and it
 * is deliberately small enough to run after every change to the pipeline.
 *
 * It drives `KnowledgeRepository` directly rather than going over MCP: the
 * search SQL is the thing under test, and HTTP would only add auth and rate
 * limiting to the measurement.
 *
 * Everything happens in its own workspace, seeded from `bench/corpus/` — copies
 * of the repo's own docs, taken on purpose so that editing a doc cannot move
 * the numbers underneath a comparison. Live workspaces are never touched.
 *
 *   pnpm bench            reseed and score
 *   pnpm bench --no-seed  score what is already indexed
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Actor } from '../src/domain.js';
import { KnowledgeRepository } from '../src/knowledge-repository.js';

type Relevant = { doc: string; anchor: string };
type Question = { question: string; relevant: Relevant[] };
type SearchResult = { title?: string; excerpt?: string };

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, 'corpus');
const WORKSPACE = 'Benchmark';
const SLUG = 'benchmark';
const LIMIT = 10;

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

const config = {
  DATABASE_URL: required('DATABASE_URL'),
  OLLAMA_URL: required('OLLAMA_URL'),
  EMBEDDING_MODEL: required('EMBEDDING_MODEL'),
  EMBEDDING_QUERY_INSTRUCTION: process.env.EMBEDDING_QUERY_INSTRUCTION,
  PORT: 0,
  MARKITDOWN_URL: 'http://unused',
  SOURCE_STORAGE_PATH: '/tmp/commonwealth-bench',
  MAX_UPLOAD_BYTES: 1,
  MAX_REQUEST_BYTES: 1,
  TRUST_FORWARDED_FOR: false,
  RATE_LIMIT_KEY_WINDOW: 60,
  RATE_LIMIT_KEY_MAX: 120,
  RATE_LIMIT_ADDRESS_WINDOW: 60,
  RATE_LIMIT_ADDRESS_MAX: 600,
};

const { Embeddings } = await import('@commonwealth/pipeline');
const knowledge = new KnowledgeRepository(
  config,
  new Embeddings({
    ollamaUrl: config.OLLAMA_URL,
    model: config.EMBEDDING_MODEL,
    queryInstruction: config.EMBEDDING_QUERY_INSTRUCTION,
  })
);
const sql = knowledge.sql;

/* Idempotent: the workspace, its index configuration and its actor are created
   once and reused, so repeated runs compare like with like. */
const [workspace] = await sql<{ id: string }[]>`
  INSERT INTO workspaces (name, slug) VALUES (${WORKSPACE}, ${SLUG})
  ON CONFLICT (slug) DO UPDATE SET name = ${WORKSPACE}
  RETURNING id
`;
if (!workspace) throw new Error('Could not create the benchmark workspace');

await sql`
  INSERT INTO index_configuration (workspace_id, embedding_model, embedding_dimensions)
  VALUES (${workspace.id}, ${config.EMBEDDING_MODEL}, 1024)
  ON CONFLICT (workspace_id) DO NOTHING
`;

let [agent] = await sql<{ id: string }[]>`
  SELECT id FROM users WHERE workspace_id = ${workspace.id} AND display_name = 'Benchmark'
`;
if (!agent) {
  [agent] = await sql<{ id: string }[]>`
    INSERT INTO users (workspace_id, display_name, role, auto_approve)
    VALUES (${workspace.id}, 'Benchmark', 'admin', true) RETURNING id
  `;
}
if (!agent) throw new Error('Could not create the benchmark actor');

const actor: Actor = {
  id: agent.id,
  workspaceId: workspace.id,
  name: 'Benchmark',
  role: 'admin',
  autoApprove: true,
};

if (!process.argv.includes('--no-seed')) {
  /* Hard delete rather than the product's soft delete: this workspace holds no
     history worth keeping, and a soft-deleted source would keep its chunks and
     its content hash, so the next reseed would collide on both. */
  await sql`DELETE FROM sources WHERE workspace_id = ${workspace.id}`;

  const files = (await readdir(CORPUS)).filter((name) => name.endsWith('.md')).sort();
  const startedAt = Date.now();
  let chunks = 0;
  for (const file of files) {
    const markdown = await readFile(join(CORPUS, file), 'utf8');
    const result = await knowledge.submitNote(actor, { title: file, markdown, tags: [] });
    chunks += result.chunkCount;
    console.log(`  indexed ${file} — ${result.chunkCount} chunks`);
  }
  const seconds = (Date.now() - startedAt) / 1000;
  console.log(
    `\n${files.length} documents, ${chunks} chunks in ${seconds.toFixed(1)}s ` +
      `(${(chunks / seconds).toFixed(1)} chunks/sec)\n`
  );
}

const { questions } = JSON.parse(await readFile(join(here, 'questions.json'), 'utf8')) as {
  questions: Question[];
};

/* A hit is the right document *and* the right passage within it. Matching on
   the document alone would score a five-chunk file as correct for any of its
   chunks, which is most of what this is trying to measure.
 *
 * Whitespace is flattened on both sides. An anchor is a phrase, and where the
 * source file happens to wrap a line is not part of it — four labels in the
 * first run "missed" only because the stored chunk had a newline where the
 * anchor had a space, which understated the score against a real improvement.
 * Now that chunks keep their newlines, this matters. */
const flatten = (text: string): string => text.replace(/\s+/g, ' ');

const hits = (result: SearchResult, relevant: Relevant[]): boolean =>
  relevant.some(
    (entry) =>
      result.title === entry.doc && flatten(result.excerpt ?? '').includes(flatten(entry.anchor))
  );

/* A label pointing at text no chunk contains can never be found, and would be
   reported as a retrieval failure forever. Cheaper to refuse than to spend an
   afternoon tuning against a typo. */
const reachable = await sql<{ title: string; content: string }[]>`
  SELECT revision.title, chunks.content
  FROM chunks
  JOIN source_revisions AS revision ON revision.id = chunks.source_revision_id
  JOIN sources ON sources.current_revision_id = revision.id
  WHERE sources.workspace_id = ${workspace.id}
`;
const impossible = questions.flatMap((item) =>
  item.relevant
    .filter(
      (entry) =>
        !reachable.some(
          (row) => row.title === entry.doc && flatten(row.content).includes(flatten(entry.anchor))
        )
    )
    .map((entry) => `${entry.doc} :: "${entry.anchor}"  (${item.question})`)
);
if (impossible.length > 0) {
  console.error(
    `\n${impossible.length} gold label(s) match no chunk. Fix these before reading any number:`
  );
  for (const entry of impossible) console.error(`  · ${entry}`);
  await knowledge.close();
  process.exit(1);
}

let recallAt5 = 0;
let reciprocalRankTotal = 0;
const latencies: number[] = [];
const misses: string[] = [];

for (const item of questions) {
  const startedAt = Date.now();
  const results = (await knowledge.search(actor, {
    query: item.question,
    tags: [],
    limit: LIMIT,
    explain: false,
  })) as SearchResult[];
  latencies.push(Date.now() - startedAt);

  const rank = results.findIndex((result) => hits(result, item.relevant)) + 1;
  if (rank > 0 && rank <= 5) recallAt5++;
  if (rank > 0) reciprocalRankTotal += 1 / rank;
  else misses.push(item.question);
}

const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

const total = questions.length;
console.log(`${total} questions against ${WORKSPACE}, top ${LIMIT}\n`);
console.log(`  Recall@5    ${((recallAt5 / total) * 100).toFixed(1)}%  (${recallAt5}/${total})`);
console.log(`  MRR         ${(reciprocalRankTotal / total).toFixed(3)}`);
console.log(
  `  latency     p50 ${percentile(latencies, 0.5)}ms   p95 ${percentile(latencies, 0.95)}ms`
);
console.log(`  model       ${config.EMBEDDING_MODEL}`);
console.log(`  query hint  ${config.EMBEDDING_QUERY_INSTRUCTION ? 'on' : 'off'}`);

/* Named, not counted. A miss is a question to read and argue with — either the
   retrieval is wrong or the gold label is, and only looking tells you which. */
if (misses.length > 0) {
  console.log(`\n  not found in the top ${LIMIT}:`);
  for (const miss of misses) console.log(`    · ${miss}`);
}

await knowledge.close();
