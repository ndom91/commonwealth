import { createHash } from 'node:crypto';
import { head, listConceptPaths, readFileAtCommit } from '@commonwealth/corpus';
import {
  chunkMarkdown,
  type Embeddings,
  embeddingInput,
  parseOkfDocument,
} from '@commonwealth/pipeline';
import type { JSONValue, Sql } from 'postgres';

type Concept = {
  authority: 'approved' | 'canonical' | 'unverified';
  body: string;
  contentHash: string;
  description: string | null;
  frontmatter: Record<string, unknown>;
  generatedAt: string | null;
  generatedBy: string | null;
  path: string;
  status: 'deprecated' | 'draft' | 'stable';
  tags: string[];
  title: string | null;
  type: string;
};

export type IndexResult = {
  chunks: number;
  commit: string;
  concepts: number;
  indexed: boolean;
};

export type IndexWorkspaceInput = {
  corpusPath: string;
  embeddingModel: string;
  embeddings: Pick<Embeddings, 'embed'>;
  sql: Sql;
  workspaceId: string;
  workspaceSlug: string;
};

// indexWorkspace derives a complete searchable snapshot from one workspace Git commit.
export async function indexWorkspace(input: IndexWorkspaceInput): Promise<IndexResult> {
  const commit = await head(input.corpusPath, input.workspaceSlug);
  await input.sql`
    INSERT INTO workspace_index_state (workspace_id, indexing_commit_sha, status, failure)
    VALUES (${input.workspaceId}, ${commit}, 'indexing', NULL)
    ON CONFLICT (workspace_id) DO UPDATE
    SET indexing_commit_sha = EXCLUDED.indexing_commit_sha, status = 'indexing', failure = NULL,
        updated_at = now()
  `;

  try {
    const concepts = await conceptsAtCommit(input.corpusPath, input.workspaceSlug, commit);
    const prepared = await prepareChunks(concepts, input.embeddings);
    const indexed = await input.sql.begin(async (transaction) => {
      const [state] = await transaction<{ indexing_commit_sha: string | null }[]>`
        SELECT indexing_commit_sha FROM workspace_index_state
        WHERE workspace_id = ${input.workspaceId} FOR UPDATE
      `;
      if (!state || state.indexing_commit_sha !== commit) return false;

      await transaction`
        DELETE FROM concepts WHERE workspace_id = ${input.workspaceId} AND commit_sha = ${commit}
      `;
      for (const concept of concepts) {
        const chunks = prepared.get(concept.path);
        if (!chunks) throw new Error(`Concept ${concept.path} was not prepared`);
        await transaction`
          INSERT INTO concepts (
            workspace_id, path, commit_sha, content_hash, type, title, description, tags,
            frontmatter, status, authority, generated_by, generated_at, expected_chunks
          ) VALUES (
            ${input.workspaceId}, ${concept.path}, ${commit}, ${concept.contentHash}, ${concept.type},
            ${concept.title}, ${concept.description}, ${concept.tags},
            ${transaction.json(concept.frontmatter as JSONValue)},
            ${concept.status}, ${concept.authority}, ${concept.generatedBy}, ${concept.generatedAt}, ${chunks.length}
          )
        `;
        for (const [ordinal, chunk] of chunks.entries()) {
          await transaction`
            INSERT INTO concept_chunks (
              workspace_id, concept_path, commit_sha, ordinal, heading, content, token_count,
              embedding, embedding_model
            ) VALUES (
              ${input.workspaceId}, ${concept.path}, ${commit}, ${ordinal}, ${chunk.heading},
              ${chunk.content}, ${chunk.tokenCount}, ${vector(chunk.embedding)}::vector,
              ${input.embeddingModel}
            )
          `;
        }
      }
      await transaction`
        UPDATE workspace_index_state
        SET indexed_commit_sha = ${commit}, indexing_commit_sha = NULL, status = 'idle', failure = NULL,
            updated_at = now()
        WHERE workspace_id = ${input.workspaceId} AND indexing_commit_sha = ${commit}
      `;

      return true;
    });
    let chunks = 0;
    for (const concept of prepared.values()) chunks += concept.length;

    return { commit, concepts: concepts.length, chunks, indexed };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    await input.sql`
      UPDATE workspace_index_state
      SET status = 'failed', failure = ${failure}, updated_at = now()
      WHERE workspace_id = ${input.workspaceId} AND indexing_commit_sha = ${commit}
    `;
    throw error;
  }
}

async function conceptsAtCommit(
  corpusPath: string,
  workspace: string,
  commit: string
): Promise<Concept[]> {
  const paths = await listConceptPaths(corpusPath, workspace, commit);
  const concepts: Concept[] = [];
  for (const path of paths) {
    const text = await readFileAtCommit(corpusPath, workspace, path, commit);
    const document = parseOkfDocument(text);
    const status = statusOf(document.frontmatter.status);
    if (status === 'deprecated') continue;
    const chunks = chunkMarkdown(text);
    if (chunks.length === 0) throw new Error(`Concept ${path} has no indexable body`);
    const type = document.frontmatter.type;
    if (typeof type !== 'string') throw new Error(`Concept ${path} has an invalid type`);
    concepts.push({
      authority: authorityOf(document.frontmatter.commonwealth),
      body: document.body,
      contentHash: createHash('sha256').update(text).digest('hex'),
      description: stringOf(document.frontmatter.description),
      frontmatter: document.frontmatter,
      generatedAt: nestedString(document.frontmatter.generated, 'at'),
      generatedBy: nestedString(document.frontmatter.generated, 'by'),
      path,
      status,
      tags: stringsOf(document.frontmatter.tags, 'tags'),
      title: stringOf(document.frontmatter.title),
      type,
    });
  }

  return concepts;
}

async function prepareChunks(concepts: Concept[], embeddings: Pick<Embeddings, 'embed'>) {
  const prepared = new Map<
    string,
    Array<ReturnType<typeof chunkMarkdown>[number] & { embedding: number[] }>
  >();
  for (const concept of concepts) {
    const chunks = chunkMarkdown(concept.body);
    const vectors = await embeddings.embed(chunks.map(embeddingInput));
    if (vectors.length !== chunks.length)
      throw new Error(`Embedding for ${concept.path} was incomplete`);
    const indexed: Array<ReturnType<typeof chunkMarkdown>[number] & { embedding: number[] }> = [];
    for (const [ordinal, chunk] of chunks.entries()) {
      const embedding = vectors[ordinal];
      if (!embedding) throw new Error(`Embedding for ${concept.path} was incomplete`);
      indexed.push({ ...chunk, embedding });
    }
    prepared.set(concept.path, indexed);
  }

  return prepared;
}

function authorityOf(value: unknown): 'approved' | 'canonical' | 'unverified' {
  if (!isObject(value)) return 'unverified';
  const authority = value.authority;
  if (authority === 'approved' || authority === 'canonical' || authority === 'unverified')
    return authority;

  return 'unverified';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nestedString(value: unknown, key: string): string | null {
  if (!isObject(value)) return null;

  return stringOf(value[key]);
}

function statusOf(value: unknown): 'deprecated' | 'draft' | 'stable' {
  if (value === undefined || value === 'stable') return 'stable';
  if (value === 'draft') return 'draft';
  if (value === 'deprecated') return 'deprecated';
  throw new Error('OKF status must be draft, stable, or deprecated');
}

function stringOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  return value;
}

function stringsOf(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`OKF ${field} must be an array of strings`);
  }

  return value;
}

function vector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
