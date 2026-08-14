/* Retrieval benchmark against a disposable Git-native workspace.
 *
 *   pnpm bench            commit the fixture corpus and score it
 *   pnpm bench --no-seed  score the published fixture commit
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitFiles } from '@commonwealth/corpus';
import { indexWorkspace } from '@commonwealth/corpus/indexer';
import { Embeddings, serializeOkfDocument } from '@commonwealth/pipeline';
import postgres from 'postgres';
import type { Actor } from '../src/domain.js';
import { OkfRepository } from '../src/okf-repository.js';

type Relevant = { doc: string; anchor: string };
type Question = { question: string; relevant: Relevant[] };

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'corpus');
const slug = 'benchmark';
const corpusPath = process.env.CORPUS_PATH?.trim() || '/tmp/commonwealth-bench-corpus';

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
  CORPUS_PATH: corpusPath,
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
const sql = postgres(config.DATABASE_URL);
const embeddings = new Embeddings({
  ollamaUrl: config.OLLAMA_URL,
  model: config.EMBEDDING_MODEL,
  queryInstruction: config.EMBEDDING_QUERY_INSTRUCTION,
});

const [workspace] = await sql<{ id: string }[]>`
  INSERT INTO workspaces (name, slug) VALUES ('Benchmark', ${slug})
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id
`;
if (!workspace) throw new Error('Could not create benchmark workspace');
await sql`
  INSERT INTO index_configuration (workspace_id, embedding_model, embedding_dimensions)
  VALUES (${workspace.id}, ${config.EMBEDDING_MODEL}, 1024)
  ON CONFLICT (workspace_id) DO NOTHING
`;
let [user] = await sql<{ id: string }[]>`
  SELECT id FROM users WHERE workspace_id = ${workspace.id} AND display_name = 'Benchmark'
`;
if (!user) {
  [user] = await sql<{ id: string }[]>`
    INSERT INTO users (workspace_id, display_name, role, auto_approve)
    VALUES (${workspace.id}, 'Benchmark', 'admin', true) RETURNING id
  `;
}
if (!user) throw new Error('Could not create benchmark identity');
const actor: Actor = {
  id: user.id,
  workspaceId: workspace.id,
  workspaceSlug: slug,
  name: 'Benchmark',
  role: 'admin',
  autoApprove: true,
};

if (!process.argv.includes('--no-seed')) {
  const files = (await readdir(fixturePath)).filter((name) => name.endsWith('.md')).sort();
  const committed = await commitFiles({
    actor: `commonwealth/${actor.id}`,
    corpusPath,
    workspace: slug,
    subject: 'Seed benchmark corpus',
    files: await Promise.all(
      files.map(async (name) => ({
        path: `bench/${name}`,
        text: serializeOkfDocument({
          frontmatter: {
            type: 'Reference',
            title: name,
            tags: ['benchmark'],
            commonwealth: { authority: 'approved' },
          },
          body: await readFile(join(fixturePath, name), 'utf8'),
        }),
      }))
    ),
  });
  const indexed = await indexWorkspace({
    corpusPath,
    embeddingModel: config.EMBEDDING_MODEL,
    embeddings,
    sql,
    workspaceId: workspace.id,
    workspaceSlug: slug,
  });
  if (!indexed.indexed || indexed.commit !== committed)
    throw new Error('Benchmark commit was not published');
}

const { questions } = JSON.parse(await readFile(join(here, 'questions.json'), 'utf8')) as {
  questions: Question[];
};
const repository = new OkfRepository(config, embeddings, sql);
const flatten = (text: string) => text.replace(/\s+/g, ' ');
let found = 0;
const started = Date.now();
for (const question of questions) {
  const results = await repository.search(actor, {
    query: question.question,
    tags: [],
    limit: 5,
    explain: false,
  });
  const hit = results.some((result) =>
    question.relevant.some(
      (relevant) =>
        result.title === relevant.doc &&
        flatten(String(result.excerpt ?? '')).includes(flatten(relevant.anchor))
    )
  );
  if (hit) found++;
}
const seconds = (Date.now() - started) / 1000;
console.log(
  `${questions.length} questions: Recall@5 ${((found / questions.length) * 100).toFixed(1)}% (${found}/${questions.length}) in ${seconds.toFixed(1)}s`
);
await sql.end();
