/* Re-chunk and re-embed every active source in a workspace.
 *
 * Needed whenever the indexing pipeline changes shape rather than merely
 * gaining a row: a new chunker moves every boundary, and a change to what goes
 * into the embedding input moves every vector. `PLAN.md` already describes the
 * model-change case — "reindex all chunks when changing the configured model or
 * vector dimension" — and there was no command to do it with. There is one
 * per-source retry in the UI, and nothing for the whole corpus.
 *
 * Lives next to `migrate.ts` rather than in the UI because it is an operator
 * action with no sensible partial state to render, and because it is the twin
 * of a migration: something you run once, deliberately, after changing how the
 * system stores what it already holds.
 *
 * The per-source transaction is copied from `retryIndexing`
 * (`src/lib/knowledge.ts`): claim the source, delete the current revision's
 * chunks, insert the new ones. Superseded revisions are left alone — their
 * chunks are history reachable through an older revision, and the rule that
 * chunks are inserted and never deleted protects them. Only the *current*
 * revision is reachable by search, so only it is rebuilt.
 *
 *   pnpm reindex --workspace default --dry-run
 *   pnpm reindex --workspace default
 */

import { chunkMarkdown, embeddingInput } from '@commonwealth/pipeline';
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

/* Only `active`. A source mid-`indexing` has a run of its own writing chunks,
   and reindexing underneath it would race for the same ordinals; `failed` has
   the retry button. Both are visible in the report so neither is a surprise. */
const sources = await client<
  { id: string; title: string; revision_id: string; markdown: string; chunks: number }[]
>`
  SELECT sources.id, revision.title, revision.id AS revision_id,
         revision.markdown_content AS markdown,
         (SELECT count(*) FROM chunks WHERE chunks.source_revision_id = revision.id) AS chunks
  FROM sources
  JOIN source_revisions AS revision ON revision.id = sources.current_revision_id
  WHERE sources.workspace_id = ${workspace.id} AND sources.status = 'active'
  ORDER BY revision.title
`;

const [skipped] = await client<{ count: number }[]>`
  SELECT count(*)::int AS count FROM sources
  WHERE workspace_id = ${workspace.id} AND status IN ('indexing', 'failed')
`;

console.log(`${workspace.name} (${slug}) — ${sources.length} active source(s)`);
if (skipped && skipped.count > 0) {
  console.log(`${skipped.count} source(s) in indexing or failed are left alone.`);
}
if (dryRun) console.log('Dry run: nothing will be written.\n');

const model = embeddingModel();
let rebuilt = 0;
const failed: string[] = [];
let before = 0;
let after = 0;

for (const source of sources) {
  const chunks = chunkMarkdown(source.markdown);
  const delta = chunks.length - Number(source.chunks);
  const arrow = delta === 0 ? '=' : delta > 0 ? `+${delta}` : String(delta);
  console.log(`  ${source.title} — ${source.chunks} → ${chunks.length} (${arrow})`);
  before += Number(source.chunks);
  after += chunks.length;

  if (dryRun) continue;

  if (chunks.length === 0) {
    /* Reachable now that a document of headings alone yields nothing. Refuse
       rather than delete: emptying a live source's index because the chunker
       changed its mind is exactly the kind of quiet loss this product is
       supposed to make impossible. */
    console.error(`    refused: chunking produced nothing. Left as it was.`);
    continue;
  }

  /* Per source, so one failure does not cost the whole run. Embedding a cold
     model blows the 30s batch deadline on the first call, and a corpus is
     exactly when that is most expensive to retry from scratch. Each source
     commits on its own, so a partial run is a resumable one: rerun and the
     sources that succeeded are simply rebuilt again. */
  try {
    const vectors = await embeddings().embed(chunks.map(embeddingInput));

    await client.begin(async (transaction) => {
      await transaction`DELETE FROM chunks WHERE source_revision_id = ${source.revision_id}`;
      for (const [ordinal, chunk] of chunks.entries()) {
        const vector = vectors[ordinal];
        if (!vector) throw new Error('Embedding provider returned an incomplete result');
        await transaction`
          INSERT INTO chunks (source_id, source_revision_id, ordinal, heading, content,
                              token_count, embedding, embedding_model)
          VALUES (${source.id}, ${source.revision_id}, ${ordinal}, ${chunk.heading},
                  ${chunk.content}, ${chunk.tokenCount},
                  ${`[${vector.join(',')}]`}::vector, ${model})
        `;
      }
    });
    rebuilt++;
  } catch (cause) {
    /* The transaction rolled back, so this source still has its old chunks.
       Stale, but present and searchable — better than empty. */
    failed.push(source.title);
    console.error(`    failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

console.log(
  `\n${dryRun ? 'Would rebuild' : 'Rebuilt'} ${dryRun ? sources.length : rebuilt} source(s): ${before} → ${after} chunks.`
);
if (failed.length > 0) {
  console.error(`${failed.length} source(s) kept their old chunks: ${failed.join(', ')}`);
}
await client.end();
/* Non-zero on any failure, so a run that half-worked cannot be mistaken for a
   clean one by whatever invoked it. */
process.exit(failed.length > 0 ? 1 : 0);
