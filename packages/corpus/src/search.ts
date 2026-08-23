import type { Embeddings } from '@commonwealth/pipeline';
import type { Sql } from 'postgres';

export type SearchWorkspaceInput = {
  authority?: string;
  embeddings: Pick<Embeddings, 'embedQuery'>;
  limit: number;
  query: string;
  sql: Sql;
  tags: string[];
  type?: string;
  workspaceId: string;
};

export type SearchWorkspaceResult = {
  authority: string;
  commit: string;
  excerpt: string;
  heading: string | null;
  path: string;
  scores: { finalScore: number; keywordScore: number; semanticScore: number };
  tags: string[];
  title: string | null;
  type: string;
};

type SearchRow = {
  authority: string;
  commit_sha: string;
  content: string;
  final_score: string;
  heading: string | null;
  keyword_score: string;
  path: string;
  semantic_score: string;
  tags: string[];
  title: string | null;
  type: string;
};

// searchWorkspace is the one retrieval implementation used by MCP and the bench.
export async function searchWorkspace(
  input: SearchWorkspaceInput
): Promise<SearchWorkspaceResult[]> {
  const embedding = await input.embeddings.embedQuery(input.query);
  if (!embedding) throw new Error('Embedding provider returned no query embedding');

  const vectorInput = vector(embedding);
  const tags = input.tags.length === 0 ? null : input.tags;
  const candidateLimit = Math.max(input.limit * 10, 50);
  const rows = await input.sql<SearchRow[]>`
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
      WHERE concepts.workspace_id = ${input.workspaceId} AND concepts.status = 'stable'
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

  return rows.map((row) => ({
    path: row.path,
    commit: row.commit_sha,
    type: row.type,
    title: row.title,
    tags: row.tags,
    authority: row.authority,
    heading: row.heading,
    excerpt: row.content,
    scores: {
      semanticScore: Number(row.semantic_score),
      keywordScore: Number(row.keyword_score),
      finalScore: Number(row.final_score),
    },
  }));
}

function vector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
