/* Rebuild the derived retrieval index from the current Git commit.
 *
 * The bundle remains authoritative: this command never edits a concept. It
 * reads HEAD, embeds every OKF document, and atomically publishes that commit.
 *
 *   pnpm reindex --workspace default --dry-run
 *   pnpm reindex --workspace default
 */

import { head } from '@commonwealth/corpus';
import { indexWorkspace } from '@commonwealth/corpus/indexer';
import { client } from '../src/lib/db.js';
import { embeddingModel, embeddings } from '../src/lib/pipeline.js';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const slug = flag('workspace');
const dryRun = process.argv.includes('--dry-run');
if (!slug) {
  console.error('Usage: pnpm reindex --workspace <slug> [--dry-run]');
  process.exit(1);
}

const [workspace] = await client<{ id: string; name: string }[]>`
  SELECT id, name FROM workspaces WHERE slug = ${slug}
`;
if (!workspace) {
  console.error(`No workspace with slug "${slug}".`);
  process.exit(1);
}

const corpusPath = process.env.CORPUS_PATH?.trim() || '/app/corpora';
const commit = await head(corpusPath, slug);
if (dryRun) {
  const [current] = await client<{ concepts: string; chunks: string }[]>`
    SELECT
      (SELECT count(*) FROM concepts WHERE workspace_id = ${workspace.id}
        AND commit_sha = ${commit}) AS concepts,
      (SELECT count(*) FROM concept_chunks WHERE workspace_id = ${workspace.id}
        AND commit_sha = ${commit}) AS chunks
  `;
  console.log(`${workspace.name} (${slug}) — ${commit.slice(0, 12)}`);
  console.log(
    `Would rebuild ${current?.concepts ?? 0} concept(s) and ${current?.chunks ?? 0} passage(s).`
  );
} else {
  const result = await indexWorkspace({
    corpusPath,
    embeddingModel: embeddingModel(),
    embeddings: embeddings(),
    sql: client,
    workspaceId: workspace.id,
    workspaceSlug: slug,
  });
  console.log(
    `Published ${result.commit.slice(0, 12)}: ${result.concepts} concept(s), ${result.chunks} passage(s).`
  );
}
await client.end();
