import { history, readFileAtCommit } from '@commonwealth/corpus';
import { searchProject } from '@commonwealth/corpus/search';
import { okfMetadata, parseOkfDocument } from '@commonwealth/pipeline';
import { createServerFn } from '@tanstack/react-start';
import { requireMember, type Scoped, validateProject, validateScope } from './authorize.js';
import {
  type Authority,
  corpusPath,
  optionalFilters,
  optionalText,
  pathInput,
  retrievalInput,
  versionInput,
} from './concept-inputs.js';
import { conceptVersion } from './concept-inspection.js';
import { client } from './db.js';
import { embeddings } from './pipeline.js';

export const PAGE_SIZE = 40;

export const listConcepts = createServerFn({ method: 'GET' })
  .validator(optionalFilters)
  .handler(async ({ data }) => {
    const { projectId } = await requireMember('read', data.project);
    return client`
      SELECT concepts.path, concepts.commit_sha, concepts.type, concepts.title, concepts.tags,
             concepts.authority, concepts.generated_by, concepts.generated_at
      FROM concepts
      JOIN project_index_state ON project_index_state.project_id = concepts.project_id
        AND project_index_state.indexed_commit_sha = concepts.commit_sha
      WHERE concepts.project_id = ${projectId} AND concepts.status = 'stable'
        AND (${data.authority}::text IS NULL OR concepts.authority = ${data.authority})
        AND (${data.type}::text IS NULL OR concepts.type = ${data.type})
      ORDER BY concepts.path
      LIMIT ${PAGE_SIZE}
    `;
  });

export const searchConcepts = createServerFn({ method: 'GET' })
  .validator(
    (
      value: unknown
    ): Scoped<{ authority: Authority | null; query: string; type: string | null }> => {
      const input = (value ?? {}) as Record<string, unknown>;
      const query = optionalText(input.query, 'search');
      if (!query || query.length > 200) throw new Error('Invalid search');
      return { ...optionalFilters(value), query };
    }
  )
  .handler(async ({ data }) => {
    const { projectId } = await requireMember('read', data.project);
    return client`
      WITH terms AS (SELECT websearch_to_tsquery('english', ${data.query}) AS value)
      SELECT concepts.path, concepts.commit_sha, concepts.type, concepts.title, concepts.tags,
             concepts.authority, concepts.generated_by, concepts.generated_at,
             body.excerpt
      FROM concepts
      JOIN project_index_state ON project_index_state.project_id = concepts.project_id
        AND project_index_state.indexed_commit_sha = concepts.commit_sha
      CROSS JOIN terms
      LEFT JOIN LATERAL (
        SELECT ts_headline('english', concept_chunks.content, terms.value,
          'MaxFragments=1, MaxWords=28, MinWords=12, StartSel=\x02, StopSel=\x03') AS excerpt
        FROM concept_chunks
        WHERE concept_chunks.project_id = concepts.project_id
          AND concept_chunks.concept_path = concepts.path AND concept_chunks.commit_sha = concepts.commit_sha
          AND concept_chunks.search_vector @@ terms.value
        ORDER BY ts_rank_cd(concept_chunks.search_vector, terms.value) DESC
        LIMIT 1
      ) AS body ON true
      WHERE concepts.project_id = ${projectId} AND concepts.status = 'stable'
        AND (${data.authority}::text IS NULL OR concepts.authority = ${data.authority})
        AND (${data.type}::text IS NULL OR concepts.type = ${data.type})
        AND (body.excerpt IS NOT NULL OR strpos(lower(COALESCE(concepts.title, '')), lower(${data.query})) > 0)
      ORDER BY (strpos(lower(COALESCE(concepts.title, '')), lower(${data.query})) > 0) DESC, concepts.path
      LIMIT 25
    `;
  });

export const getConceptDetail = createServerFn({ method: 'GET' })
  .validator(pathInput)
  .handler(async ({ data }) => {
    const membership = await requireMember('read', data.project);
    const [concept] = await client<
      {
        commit_sha: string;
        path: string;
        frontmatter: Record<string, unknown>;
        content_hash: string;
        type: string;
        title: string | null;
        tags: string[];
        authority: Authority;
        generated_at: string | null;
        generated_by: string | null;
      }[]
    >`
      SELECT concepts.commit_sha, concepts.path, concepts.frontmatter, concepts.content_hash, concepts.type,
             concepts.title, concepts.tags, concepts.authority, concepts.generated_at, concepts.generated_by
      FROM concepts
      JOIN project_index_state ON project_index_state.project_id = concepts.project_id
        AND project_index_state.indexed_commit_sha = concepts.commit_sha
      WHERE concepts.project_id = ${membership.projectId} AND concepts.path = ${data.path}
        AND concepts.status = 'stable'
    `;
    if (!concept) throw new Error('That concept is not in the indexed project commit');
    const markdown = await readFileAtCommit(
      corpusPath(),
      membership.slug,
      concept.path,
      concept.commit_sha
    );
    const document = parseOkfDocument(markdown);
    const metadata = okfMetadata(document.frontmatter);
    const { frontmatter: _frontmatter, ...detail } = concept;
    return {
      ...detail,
      markdown,
      body: document.body,
      last_verified_at: metadata.lastVerifiedAt,
    };
  });

/* A source mutation immediately refreshes this list. POST avoids the browser
   serving an earlier history response for the same project/path URL. */
export const getConceptHistory = createServerFn({ method: 'POST' })
  .validator(pathInput)
  .handler(async ({ data }) => {
    const membership = await requireMember('read', data.project);
    return history(corpusPath(), membership.slug, data.path);
  });

export const getConceptVersion = createServerFn({ method: 'GET' })
  .validator(versionInput)
  .handler(async ({ data }) => {
    const membership = await requireMember('read', data.project);
    return conceptVersion({ ...data, corpusPath: corpusPath(), project: membership.slug });
  });

export const inspectRetrieval = createServerFn({ method: 'GET' })
  .validator(retrievalInput)
  .handler(async ({ data }) => {
    const { projectId } = await requireMember('read', data.project);
    return searchProject({
      authority: data.authority ?? undefined,
      embeddings: embeddings(),
      limit: data.limit,
      query: data.query,
      sql: client,
      tags: data.tags,
      type: data.type ?? undefined,
      projectId,
    });
  });

export const listReviewQueue = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { projectId } = await requireMember('read', data.project);
    return reviewQueue(projectId);
  });

export const getNavCounts = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { projectId } = await requireMember('read', data.project);
    const [row] = await client<
      { identities: string; people: string; sources: string; review: string }[]
    >`
      SELECT
        (SELECT count(*) FROM users WHERE project_id = ${projectId}) AS identities,
        (SELECT count(*) FROM member WHERE project_id = ${projectId}) AS people,
        (SELECT count(*) FROM concepts JOIN project_index_state ON project_index_state.project_id = concepts.project_id AND project_index_state.indexed_commit_sha = concepts.commit_sha WHERE concepts.project_id = ${projectId} AND concepts.status = 'stable') AS sources,
        0 AS review
    `;
    const review = (await reviewQueue(projectId)).length;
    return {
      identities: Number(row?.identities ?? 0),
      people: Number(row?.people ?? 0),
      sources: Number(row?.sources ?? 0),
      review,
    };
  });

export const getRegisterSummary = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { projectId } = await requireMember('read', data.project);
    const rows = await reviewQueue(projectId);
    const [row] = await client<
      {
        canonical: string;
        chunks: string;
        last_retrieved: string | null;
        last_verified: string | null;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM concepts JOIN project_index_state ON project_index_state.project_id = concepts.project_id AND project_index_state.indexed_commit_sha = concepts.commit_sha WHERE concepts.project_id = ${projectId} AND concepts.status = 'stable' AND concepts.authority = 'canonical') AS canonical,
        (SELECT count(*) FROM concept_chunks JOIN project_index_state ON project_index_state.project_id = concept_chunks.project_id AND project_index_state.indexed_commit_sha = concept_chunks.commit_sha WHERE concept_chunks.project_id = ${projectId}) AS chunks,
        (SELECT max(NULLIF(concepts.frontmatter #>> '{verified,-1,at}', '')::timestamptz) FROM concepts JOIN project_index_state ON project_index_state.project_id = concepts.project_id AND project_index_state.indexed_commit_sha = concepts.commit_sha WHERE concepts.project_id = ${projectId} AND concepts.status = 'stable') AS last_verified,
        (SELECT max(created_at) FROM events WHERE project_id = ${projectId} AND event_type = 'search') AS last_retrieved
    `;
    return {
      unverified: rows.filter((concept) => concept.is_unverified).length,
      stale: rows.filter((concept) => !concept.is_unverified && concept.is_stale).length,
      canonical: Number(row?.canonical ?? 0),
      withdrawn: 0,
      chunks: Number(row?.chunks ?? 0),
      lastVerified: row?.last_verified ?? null,
      lastRetrieved: row?.last_retrieved ?? null,
    };
  });

export const listEvents = createServerFn({ method: 'GET' })
  .validator((value: unknown): Scoped<{ eventType: string | null }> => {
    const eventType = optionalText((value as Record<string, unknown>).eventType, 'event type');
    if (eventType && !/^[a-z_]{1,64}$/.test(eventType)) throw new Error('Invalid event type');
    return { project: validateProject(value), eventType };
  })
  .handler(async ({ data }) => {
    const { projectId } = await requireMember('read', data.project);
    const rows = await client`
      SELECT events.id, events.event_type, events.metadata, events.created_at,
             events.metadata ->> 'path' AS concept_path,
             agent.display_name AS actor_agent, administrator.email AS actor_admin
      FROM events
      LEFT JOIN users AS agent ON agent.id = events.actor_id
      LEFT JOIN "user" AS administrator ON administrator.id = events.actor_admin_id
      WHERE events.project_id = ${projectId}
        AND (${data.eventType}::text IS NULL OR events.event_type = ${data.eventType})
      ORDER BY events.created_at DESC, events.id DESC LIMIT ${PAGE_SIZE + 1}
    `;
    return { events: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
  });

export const listEventTypes = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { projectId } = await requireMember('read', data.project);
    const rows = await client<{ event_type: string; count: string }[]>`
      SELECT event_type, count(*) AS count FROM events WHERE project_id = ${projectId}
      GROUP BY event_type ORDER BY event_type
    `;
    return rows.map((row) => ({ eventType: row.event_type, count: Number(row.count) }));
  });

async function reviewQueue(projectId: string) {
  const rows = await client<
    Array<{
      path: string;
      commit_sha: string;
      type: string;
      title: string | null;
      authority: Authority;
      generated_at: string | null;
      frontmatter: Record<string, unknown>;
      is_stale: boolean;
    }>
  >`
    SELECT concepts.path, concepts.commit_sha, concepts.type, concepts.title, concepts.authority,
           concepts.generated_at, concepts.frontmatter,
           concepts.generated_at > NULLIF(concepts.frontmatter #>> '{verified,-1,at}', '')::timestamptz AS is_stale
    FROM concepts
    JOIN project_index_state ON project_index_state.project_id = concepts.project_id
      AND project_index_state.indexed_commit_sha = concepts.commit_sha
    WHERE concepts.project_id = ${projectId} AND concepts.status = 'stable'
    ORDER BY concepts.path
  `;
  return rows
    .map((row) => {
      const verifiedAt = okfMetadata(row.frontmatter).lastVerifiedAt;
      return {
        path: row.path,
        commit_sha: row.commit_sha,
        type: row.type,
        title: row.title,
        authority: row.authority,
        generated_at: row.generated_at,
        last_verified_at: verifiedAt,
        is_unverified: row.authority === 'unverified',
        is_stale: row.is_stale,
      };
    })
    .filter((row) => row.is_unverified || row.is_stale);
}
