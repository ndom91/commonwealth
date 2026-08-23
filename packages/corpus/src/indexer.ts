import { createHash } from 'node:crypto';
import {
  chunkMarkdown,
  type Embeddings,
  embeddingInput,
  parseOkfDocument,
} from '@commonwealth/pipeline';
import type { JSONValue, Sql } from 'postgres';
import { head, listConceptPaths, readFileAtCommit } from './corpus.js';

export type IndexResult = { chunks: number; commit: string; concepts: number; indexed: boolean };

export type IndexProjectInput = {
  corpusPath: string;
  embeddingModel: string;
  embeddings: Pick<Embeddings, 'embed'>;
  sql: Sql;
  projectId: string;
  projectSlug: string;
};

// indexProject publishes one complete Git commit as the project retrieval snapshot.
export async function indexProject(input: IndexProjectInput): Promise<IndexResult> {
  const commit = await head(input.corpusPath, input.projectSlug);
  await input.sql`
    INSERT INTO project_index_state (project_id, indexing_commit_sha, status, failure)
    VALUES (${input.projectId}, ${commit}, 'indexing', NULL)
    ON CONFLICT (project_id) DO UPDATE
    SET indexing_commit_sha = EXCLUDED.indexing_commit_sha, status = 'indexing', failure = NULL,
        updated_at = now()
  `;

  try {
    const concepts = await conceptsAtCommit(input.corpusPath, input.projectSlug, commit);
    const prepared = await prepareChunks(concepts, input.embeddings);
    const indexed = await input.sql.begin(async (transaction) => {
      const [state] = await transaction<{ indexing_commit_sha: string | null }[]>`
        SELECT indexing_commit_sha FROM project_index_state
        WHERE project_id = ${input.projectId} FOR UPDATE
      `;
      if (!state || state.indexing_commit_sha !== commit) return false;

      await transaction`
        DELETE FROM concepts WHERE project_id = ${input.projectId} AND commit_sha = ${commit}
      `;
      for (const concept of concepts) {
        const chunks = prepared.get(concept.path);
        if (!chunks) throw new Error(`Concept ${concept.path} was not prepared`);
        await transaction`
          INSERT INTO concepts (
            project_id, path, commit_sha, content_hash, type, title, description, tags,
            frontmatter, status, authority, generated_by, generated_at, expected_chunks
          ) VALUES (
            ${input.projectId}, ${concept.path}, ${commit}, ${concept.contentHash}, ${concept.type},
            ${concept.title}, ${concept.description}, ${concept.tags},
            ${transaction.json(concept.frontmatter as JSONValue)},
            ${concept.status}, ${concept.authority}, ${concept.generatedBy}, ${concept.generatedAt}, ${chunks.length}
          )
        `;
        for (const [ordinal, chunk] of chunks.entries()) {
          await transaction`
            INSERT INTO concept_chunks (
              project_id, concept_path, commit_sha, ordinal, heading, content, token_count,
              embedding, embedding_model
            ) VALUES (
              ${input.projectId}, ${concept.path}, ${commit}, ${ordinal}, ${chunk.heading},
              ${chunk.content}, ${chunk.tokenCount}, ${vector(chunk.embedding)}::vector,
              ${input.embeddingModel}
            )
          `;
        }
      }
      await transaction`
        UPDATE project_index_state
        SET indexed_commit_sha = ${commit}, indexing_commit_sha = NULL, status = 'idle', failure = NULL,
            updated_at = now()
        WHERE project_id = ${input.projectId} AND indexing_commit_sha = ${commit}
      `;

      return true;
    });
    const chunks = [...prepared.values()].reduce((total, concept) => total + concept.length, 0);

    return { commit, concepts: concepts.length, chunks, indexed };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    await input.sql`
      UPDATE project_index_state
      SET status = 'failed', failure = ${failure}, updated_at = now()
      WHERE project_id = ${input.projectId} AND indexing_commit_sha = ${commit}
    `;
    throw error;
  }
}

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

async function conceptsAtCommit(
  corpusPath: string,
  project: string,
  commit: string
): Promise<Concept[]> {
  const paths = await listConceptPaths(corpusPath, project, commit);
  const concepts: Concept[] = [];
  for (const path of paths) {
    const text = await readFileAtCommit(corpusPath, project, path, commit);
    const document = parseOkfDocument(text);
    const status = statusOf(document.frontmatter.status);
    if (status === 'deprecated') continue;
    if (chunkMarkdown(document.body).length === 0)
      throw new Error(`Concept ${path} has no indexable body`);
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
  const authority = objectOf(value).authority;
  return authority === 'approved' || authority === 'canonical' || authority === 'unverified'
    ? authority
    : 'unverified';
}

function statusOf(value: unknown): 'deprecated' | 'draft' | 'stable' {
  if (value === undefined || value === 'stable') return 'stable';
  if (value === 'draft' || value === 'deprecated') return value;
  throw new Error('OKF status must be draft, stable, or deprecated');
}

function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nestedString(value: unknown, key: string): string | null {
  return stringOf(objectOf(value)[key]);
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
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
