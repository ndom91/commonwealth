import { commitFiles, history, listConceptPaths, readFileAtCommit } from '@commonwealth/corpus';
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

  async getConceptHistory(actor: Actor, pathInput: string): Promise<unknown[]> {
    requirePermission(actor, 'read');
    const path = validateOkfPath(pathInput);

    return history(this.config.CORPUS_PATH, actor.workspaceSlug, path);
  }

  async reviseConcept(
    actor: Actor,
    input: { description?: string; markdown: string; path: string; tags?: string[]; title?: string }
  ): Promise<{ chunks: number; commit: string; path: string }> {
    requirePermission(actor, 'write');
    const path = validateOkfPath(input.path);
    const current = await this.currentDocument(actor, path);
    const generatedBy = actorName(actor);
    const author = nestedString(current.frontmatter.generated, 'by');
    if (actor.role === 'writer' && author !== generatedBy) {
      throw new DomainError('Writers can only revise concepts they created');
    }
    const frontmatter = { ...current.frontmatter };
    if (input.title !== undefined) frontmatter.title = input.title;
    if (input.description !== undefined) frontmatter.description = input.description;
    if (input.tags !== undefined) frontmatter.tags = uniqueTags(input.tags);
    frontmatter.generated = { by: generatedBy, at: new Date().toISOString() };

    return this.commitAndIndex(
      actor,
      path,
      frontmatter,
      input.markdown,
      `Revise ${path}`,
      'concept_revised'
    );
  }

  async deprecateConcept(
    actor: Actor,
    pathInput: string
  ): Promise<{ commit: string; path: string }> {
    requirePermission(actor, 'review');
    const path = validateOkfPath(pathInput);
    const current = await this.currentDocument(actor, path);
    const frontmatter = { ...current.frontmatter, status: 'deprecated' };
    const result = await this.commitAndIndex(
      actor,
      path,
      frontmatter,
      current.body,
      `Deprecate ${path}`,
      'concept_deprecated'
    );

    return { commit: result.commit, path };
  }

  async verifyConcept(
    actor: Actor,
    input: { authority: 'approved' | 'canonical' | 'unverified'; path: string }
  ): Promise<{ commit: string; path: string }> {
    requirePermission(actor, 'review');
    const path = validateOkfPath(input.path);
    const current = await this.currentDocument(actor, path);
    const frontmatter = { ...current.frontmatter };
    const verified = Array.isArray(frontmatter.verified) ? [...frontmatter.verified] : [];
    verified.push({ by: actorName(actor), at: new Date().toISOString() });
    frontmatter.verified = verified;
    frontmatter.commonwealth = {
      ...objectOf(frontmatter.commonwealth),
      authority: input.authority,
    };
    const result = await this.commitAndIndex(
      actor,
      path,
      frontmatter,
      current.body,
      `Verify ${path}`,
      'concept_verified'
    );

    return { commit: result.commit, path };
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

  private async commitAndIndex(
    actor: Actor,
    path: string,
    frontmatter: Record<string, unknown>,
    body: string,
    subject: string,
    eventType: string
  ): Promise<{ chunks: number; commit: string; path: string }> {
    const commit = await commitFiles({
      actor: actorName(actor),
      corpusPath: this.config.CORPUS_PATH,
      files: [{ path, text: serializeOkfDocument({ frontmatter, body: body.trim() }) }],
      subject,
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
      VALUES (${actor.workspaceId}, ${actor.id}, ${eventType}, ${this.sql.json({ path, commit })})
    `;

    return { chunks: indexed.chunks, commit, path };
  }

  private async currentDocument(actor: Actor, path: string) {
    const markdown = await readFileAtCommit(this.config.CORPUS_PATH, actor.workspaceSlug, path);
    const document = parseOkfDocument(markdown);

    return { body: document.body, frontmatter: document.frontmatter };
  }
}

function actorName(actor: Actor): string {
  return `commonwealth/${actor.id}`;
}

function objectOf(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function nestedString(value: unknown, key: string): string | null {
  return stringOf(objectOf(value)[key]);
}

function stringOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  return value;
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
