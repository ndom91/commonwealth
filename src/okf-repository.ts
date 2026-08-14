import { commitFiles, listConceptPaths, readFileAtCommit } from '@commonwealth/corpus';
import {
  type Embeddings,
  parseOkfDocument,
  serializeOkfDocument,
  validateOkfPath,
} from '@commonwealth/pipeline';
import type { Sql } from 'postgres';
import { requirePermission } from './access-service.js';
import type { Config } from './config.js';
import type { Actor } from './domain.js';
import { DomainError } from './errors.js';
import { indexWorkspace } from './okf-indexer.js';

export class OkfRepository {
  constructor(
    private readonly config: Config,
    private readonly embeddings: Pick<Embeddings, 'embed' | 'embedQuery'>,
    private readonly sql: Sql
  ) {}

  async createConcept(
    actor: Actor,
    input: {
      description?: string;
      markdown: string;
      path: string;
      tags: string[];
      title: string;
      type: string;
    }
  ): Promise<{ chunks: number; commit: string; path: string }> {
    requirePermission(actor, 'write');
    const path = validateOkfPath(input.path);
    const existing = await listConceptPaths(this.config.CORPUS_PATH, actor.workspaceSlug);
    if (existing.includes(path)) throw new DomainError('A concept already exists at that path');

    const now = new Date().toISOString();
    const authority = actor.autoApprove ? 'approved' : 'unverified';
    const generatedBy = `commonwealth/${actor.id}`;
    const frontmatter: Record<string, unknown> = {
      type: input.type,
      title: input.title,
      tags: uniqueTags(input.tags),
      generated: { by: generatedBy, at: now },
      commonwealth: { authority },
    };
    if (input.description) frontmatter.description = input.description;
    if (actor.autoApprove) frontmatter.verified = [{ by: generatedBy, at: now }];
    const commit = await commitFiles({
      actor: generatedBy,
      corpusPath: this.config.CORPUS_PATH,
      files: [{ path, text: serializeOkfDocument({ frontmatter, body: input.markdown.trim() }) }],
      subject: `Create ${path}`,
      workspace: actor.workspaceSlug,
    });
    const indexed = await indexWorkspace({
      corpusPath: this.config.CORPUS_PATH,
      embeddingModel: this.config.EMBEDDING_MODEL,
      embeddings: this.embeddings,
      sql: this.sql,
      workspaceId: actor.workspaceId,
      workspaceSlug: actor.workspaceSlug,
    });
    if (!indexed.indexed || indexed.commit !== commit) {
      throw new Error('Concept commit was superseded before indexing completed');
    }
    await this.sql`
      INSERT INTO events (workspace_id, actor_id, event_type, metadata)
      VALUES (${actor.workspaceId}, ${actor.id}, 'concept_created',
              ${this.sql.json({ path, commit, type: input.type, authority })})
    `;

    return { chunks: indexed.chunks, commit, path };
  }

  async getConcept(actor: Actor, pathInput: string): Promise<Record<string, unknown>> {
    requirePermission(actor, 'read');
    const path = validateOkfPath(pathInput);
    const [concept] = await this.sql<
      { commit_sha: string; frontmatter: Record<string, unknown>; type: string }[]
    >`
      SELECT concepts.commit_sha, concepts.frontmatter, concepts.type
      FROM concepts
      JOIN workspace_index_state ON workspace_index_state.workspace_id = concepts.workspace_id
        AND workspace_index_state.indexed_commit_sha = concepts.commit_sha
      WHERE concepts.workspace_id = ${actor.workspaceId} AND concepts.path = ${path}
        AND concepts.status = 'stable'
    `;
    if (!concept) throw new DomainError('Concept not found');
    const markdown = await readFileAtCommit(
      this.config.CORPUS_PATH,
      actor.workspaceSlug,
      path,
      concept.commit_sha
    );
    const document = parseOkfDocument(markdown);

    return { path, commit: concept.commit_sha, frontmatter: document.frontmatter, markdown };
  }

  async search(
    actor: Actor,
    input: {
      authority?: string;
      explain: boolean;
      limit: number;
      query: string;
      tags: string[];
      type?: string;
    }
  ): Promise<Record<string, unknown>[]> {
    requirePermission(actor, 'read');
    const embedding = await this.embeddings.embedQuery(input.query);
    if (!embedding) throw new Error('Embedding provider returned no query embedding');
    const vectorInput = vector(embedding);
    const tags = input.tags.length === 0 ? null : input.tags;
    const candidateLimit = Math.max(input.limit * 10, 50);
    const rows = await this.sql<Record<string, unknown>[]>`
      WITH query_terms AS (
        SELECT array_to_string(
          tsvector_to_array(to_tsvector('english', ${input.query})), ' | '
        )::tsquery AS value
      ), eligible AS NOT MATERIALIZED (
        SELECT concept_chunks.id, concept_chunks.embedding, concept_chunks.search_vector
        FROM concept_chunks
        JOIN concepts ON concepts.workspace_id = concept_chunks.workspace_id
          AND concepts.path = concept_chunks.concept_path
          AND concepts.commit_sha = concept_chunks.commit_sha
        JOIN workspace_index_state ON workspace_index_state.workspace_id = concepts.workspace_id
          AND workspace_index_state.indexed_commit_sha = concepts.commit_sha
        WHERE concepts.workspace_id = ${actor.workspaceId} AND concepts.status = 'stable'
          AND (${tags}::text[] IS NULL OR concepts.tags && ${tags}::text[])
          AND (${input.type ?? null}::text IS NULL OR concepts.type = ${input.type ?? null})
          AND (${input.authority ?? null}::text IS NULL OR concepts.authority = ${input.authority ?? null})
      ), vector_candidates AS (
        SELECT id, row_number() OVER (ORDER BY distance) AS rank
        FROM (
          SELECT id, embedding <=> ${vectorInput}::vector AS distance
          FROM eligible ORDER BY embedding <=> ${vectorInput}::vector LIMIT ${candidateLimit}
        ) AS nearest
      ), lexical_candidates AS (
        SELECT id, row_number() OVER (ORDER BY score DESC) AS rank
        FROM (
          SELECT eligible.id, ts_rank_cd(eligible.search_vector, query_terms.value) AS score
          FROM eligible CROSS JOIN query_terms
          WHERE eligible.search_vector @@ query_terms.value
          ORDER BY score DESC LIMIT ${candidateLimit}
        ) AS matching
      ), candidate_ids AS (
        SELECT id, sum(1.0 / (60 + rank)) AS rrf
        FROM (
          SELECT id, rank FROM vector_candidates
          UNION ALL
          SELECT id, rank FROM lexical_candidates
        ) AS ranked
        GROUP BY id
      )
      SELECT concepts.path, concepts.commit_sha, concepts.type, concepts.title, concepts.tags,
             concepts.authority, concept_chunks.heading, concept_chunks.content,
             1 - (concept_chunks.embedding <=> ${vectorInput}::vector) AS semantic_score,
             ts_rank_cd(concept_chunks.search_vector, query_terms.value) AS keyword_score,
             candidate_ids.rrf AS final_score
      FROM candidate_ids
      JOIN concept_chunks ON concept_chunks.id = candidate_ids.id
      JOIN concepts ON concepts.workspace_id = concept_chunks.workspace_id
        AND concepts.path = concept_chunks.concept_path AND concepts.commit_sha = concept_chunks.commit_sha
      CROSS JOIN query_terms
      ORDER BY candidate_ids.rrf DESC, concepts.path, concept_chunks.id
      LIMIT ${input.limit}
    `;
    await this.sql`
      INSERT INTO events (workspace_id, actor_id, event_type, metadata)
      VALUES (${actor.workspaceId}, ${actor.id}, 'search',
              ${this.sql.json({ query: input.query, resultCount: rows.length })})
    `;

    return rows.map((row) => searchResult(row, input.explain));
  }
}

function searchResult(row: Record<string, unknown>, explain: boolean): Record<string, unknown> {
  const result = {
    path: row.path,
    commit: row.commit_sha,
    type: row.type,
    title: row.title,
    tags: row.tags,
    authority: row.authority,
    heading: row.heading,
    excerpt: row.content,
  };
  if (!explain) return result;

  return {
    ...result,
    scores: {
      semanticScore: Number(row.semantic_score),
      keywordScore: Number(row.keyword_score),
      finalScore: Number(row.final_score),
    },
  };
}

function uniqueTags(tags: string[]): string[] {
  const unique = new Set<string>();
  for (const tag of tags) {
    const value = tag.trim();
    if (value) unique.add(value);
  }

  return [...unique];
}

function vector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
