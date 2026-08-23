import { commitFiles, history, listConceptPaths, readFileAtCommit } from '@commonwealth/corpus';
import { indexWorkspace } from '@commonwealth/corpus/indexer';
import { parseOkfDocument, serializeOkfDocument, validateOkfPath } from '@commonwealth/pipeline';
import { createServerFn } from '@tanstack/react-start';
import { requireMember, type Scoped, validateScope, validateWorkspace } from './authorize.js';
import { conceptVersion, inspectWorkspace } from './concept-inspection.js';
import { client, indexClient } from './db.js';
import { embeddingModel, embeddings } from './pipeline.js';

const AUTHORITIES = ['unverified', 'approved', 'canonical'] as const;
type Authority = (typeof AUTHORITIES)[number];
export const PAGE_SIZE = 40;

function corpusPath(): string {
  return process.env.CORPUS_PATH?.trim() || '/app/corpora';
}

function optionalAuthority(value: unknown): Authority | null {
  if (value === undefined || value === null || value === '') return null;
  if (!AUTHORITIES.includes(value as Authority)) throw new Error('Invalid authority');
  return value as Authority;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`);
  return value.trim();
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((tag) => String(tag).trim()).filter(Boolean))];
}

function actorName(userId: string): string {
  return `admin/${userId}`;
}

function pathInput(value: unknown): Scoped<{ path: string }> {
  const path = (value as { path?: string })?.path;
  if (typeof path !== 'string') throw new Error('Invalid concept path');
  return { workspace: validateWorkspace(value), path: validateOkfPath(path) };
}

function versionInput(value: unknown): Scoped<{ commit: string; path: string }> {
  const input = value as { commit?: string };
  const commit = input?.commit;
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('Invalid concept commit');
  }

  return { ...pathInput(value), commit };
}

function retrievalInput(value: unknown): Scoped<{
  authority: Authority | null;
  limit: number;
  query: string;
  tags: string[];
  type: string | null;
}> {
  const input = (value ?? {}) as Record<string, unknown>;
  const query = optionalText(input.query, 'search');
  if (!query) throw new Error('Invalid search');
  if (
    !Number.isInteger(input.limit) ||
    (input.limit as number) < 1 ||
    (input.limit as number) > 20
  ) {
    throw new Error('Invalid result limit');
  }
  if (input.tags !== undefined && !Array.isArray(input.tags)) throw new Error('Invalid tags');
  const selectedTags = input.tags ?? [];
  if (!selectedTags.every((tag) => typeof tag === 'string' && tag.trim().length > 0)) {
    throw new Error('Invalid tags');
  }

  return {
    workspace: validateWorkspace(value),
    authority: optionalAuthority(input.authority),
    limit: input.limit as number,
    query,
    tags: selectedTags.map((tag) => tag.trim()),
    type: optionalText(input.type, 'type'),
  };
}

function revisionTime(frontmatter: Record<string, unknown>): string | null {
  const verified = frontmatter.verified;
  if (!Array.isArray(verified)) return null;
  const latest = verified.at(-1);
  if (latest === null || typeof latest !== 'object') return null;
  const at = (latest as Record<string, unknown>).at;
  return typeof at === 'string' ? at : null;
}

function owner(frontmatter: Record<string, unknown>): string | null {
  const generated = frontmatter.generated;
  if (generated === null || typeof generated !== 'object') return null;
  const by = (generated as Record<string, unknown>).by;
  return typeof by === 'string' ? by : null;
}

export const listConcepts = createServerFn({ method: 'GET' })
  .validator((value: unknown): Scoped<{ authority: Authority | null; type: string | null }> => {
    const input = (value ?? {}) as Record<string, unknown>;
    return {
      workspace: validateWorkspace(value),
      authority: optionalAuthority(input.authority),
      type: optionalText(input.type, 'type'),
    };
  })
  .handler(async ({ data }) => {
    const { workspaceId } = await requireMember('read', data.workspace);
    return client`
      SELECT concepts.path, concepts.commit_sha, concepts.type, concepts.title, concepts.tags,
             concepts.authority, concepts.generated_by, concepts.generated_at
      FROM concepts
      JOIN workspace_index_state ON workspace_index_state.workspace_id = concepts.workspace_id
        AND workspace_index_state.indexed_commit_sha = concepts.commit_sha
      WHERE concepts.workspace_id = ${workspaceId} AND concepts.status = 'stable'
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
      return {
        workspace: validateWorkspace(value),
        authority: optionalAuthority(input.authority),
        query,
        type: optionalText(input.type, 'type'),
      };
    }
  )
  .handler(async ({ data }) => {
    const { workspaceId } = await requireMember('read', data.workspace);
    return client`
      WITH terms AS (SELECT websearch_to_tsquery('english', ${data.query}) AS value)
      SELECT concepts.path, concepts.commit_sha, concepts.type, concepts.title, concepts.tags,
             concepts.authority, concepts.generated_by, concepts.generated_at,
             body.excerpt
      FROM concepts
      JOIN workspace_index_state ON workspace_index_state.workspace_id = concepts.workspace_id
        AND workspace_index_state.indexed_commit_sha = concepts.commit_sha
      CROSS JOIN terms
      LEFT JOIN LATERAL (
        SELECT ts_headline('english', concept_chunks.content, terms.value,
          'MaxFragments=1, MaxWords=28, MinWords=12, StartSel=\x02, StopSel=\x03') AS excerpt
        FROM concept_chunks
        WHERE concept_chunks.workspace_id = concepts.workspace_id
          AND concept_chunks.concept_path = concepts.path AND concept_chunks.commit_sha = concepts.commit_sha
          AND concept_chunks.search_vector @@ terms.value
        ORDER BY ts_rank_cd(concept_chunks.search_vector, terms.value) DESC
        LIMIT 1
      ) AS body ON true
      WHERE concepts.workspace_id = ${workspaceId} AND concepts.status = 'stable'
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
    const membership = await requireMember('read', data.workspace);
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
      JOIN workspace_index_state ON workspace_index_state.workspace_id = concepts.workspace_id
        AND workspace_index_state.indexed_commit_sha = concepts.commit_sha
      WHERE concepts.workspace_id = ${membership.workspaceId} AND concepts.path = ${data.path}
        AND concepts.status = 'stable'
    `;
    if (!concept) throw new Error('That concept is not in the indexed workspace commit');
    const markdown = await readFileAtCommit(
      corpusPath(),
      membership.slug,
      concept.path,
      concept.commit_sha
    );
    const document = parseOkfDocument(markdown);
    const { frontmatter: _frontmatter, ...detail } = concept;
    return {
      ...detail,
      markdown,
      body: document.body,
      last_verified_at: revisionTime(document.frontmatter),
    };
  });

export const getConceptHistory = createServerFn({ method: 'GET' })
  .validator(pathInput)
  .handler(async ({ data }) => {
    const membership = await requireMember('read', data.workspace);
    return history(corpusPath(), membership.slug, data.path);
  });

export const getConceptVersion = createServerFn({ method: 'GET' })
  .validator(versionInput)
  .handler(async ({ data }) => {
    const membership = await requireMember('read', data.workspace);
    return conceptVersion({ ...data, corpusPath: corpusPath(), workspace: membership.slug });
  });

export const inspectRetrieval = createServerFn({ method: 'GET' })
  .validator(retrievalInput)
  .handler(async ({ data }) => {
    const { workspaceId } = await requireMember('read', data.workspace);
    return inspectWorkspace({
      authority: data.authority ?? undefined,
      embeddings: embeddings(),
      limit: data.limit,
      query: data.query,
      sql: client,
      tags: data.tags,
      type: data.type ?? undefined,
      workspaceId,
    });
  });

export const listReviewQueue = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { workspaceId } = await requireMember('read', data.workspace);
    return reviewQueue(workspaceId);
  });

export const getNavCounts = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { workspaceId } = await requireMember('read', data.workspace);
    const [row] = await client<
      { identities: string; people: string; sources: string; review: string }[]
    >`
      SELECT
        (SELECT count(*) FROM users WHERE workspace_id = ${workspaceId}) AS identities,
        (SELECT count(*) FROM member WHERE workspace_id = ${workspaceId}) AS people,
        (SELECT count(*) FROM concepts JOIN workspace_index_state ON workspace_index_state.workspace_id = concepts.workspace_id AND workspace_index_state.indexed_commit_sha = concepts.commit_sha WHERE concepts.workspace_id = ${workspaceId} AND concepts.status = 'stable') AS sources,
        0 AS review
    `;
    const review = (await reviewQueue(workspaceId)).length;
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
    const { workspaceId } = await requireMember('read', data.workspace);
    const rows = await reviewQueue(workspaceId);
    const [row] = await client<
      {
        canonical: string;
        chunks: string;
        last_retrieved: string | null;
        last_verified: string | null;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM concepts JOIN workspace_index_state ON workspace_index_state.workspace_id = concepts.workspace_id AND workspace_index_state.indexed_commit_sha = concepts.commit_sha WHERE concepts.workspace_id = ${workspaceId} AND concepts.status = 'stable' AND concepts.authority = 'canonical') AS canonical,
        (SELECT count(*) FROM concept_chunks JOIN workspace_index_state ON workspace_index_state.workspace_id = concept_chunks.workspace_id AND workspace_index_state.indexed_commit_sha = concept_chunks.commit_sha WHERE concept_chunks.workspace_id = ${workspaceId}) AS chunks,
        (SELECT max(NULLIF(concepts.frontmatter #>> '{verified,-1,at}', '')::timestamptz) FROM concepts JOIN workspace_index_state ON workspace_index_state.workspace_id = concepts.workspace_id AND workspace_index_state.indexed_commit_sha = concepts.commit_sha WHERE concepts.workspace_id = ${workspaceId} AND concepts.status = 'stable') AS last_verified,
        (SELECT max(created_at) FROM events WHERE workspace_id = ${workspaceId} AND event_type = 'search') AS last_retrieved
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
    return { workspace: validateWorkspace(value), eventType };
  })
  .handler(async ({ data }) => {
    const { workspaceId } = await requireMember('read', data.workspace);
    const rows = await client`
      SELECT events.id, events.event_type, events.metadata, events.created_at,
             events.metadata ->> 'path' AS concept_path,
             agent.display_name AS actor_agent, administrator.email AS actor_admin
      FROM events
      LEFT JOIN users AS agent ON agent.id = events.actor_id
      LEFT JOIN "user" AS administrator ON administrator.id = events.actor_admin_id
      WHERE events.workspace_id = ${workspaceId}
        AND (${data.eventType}::text IS NULL OR events.event_type = ${data.eventType})
      ORDER BY events.created_at DESC, events.id DESC LIMIT ${PAGE_SIZE + 1}
    `;
    return { events: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
  });

export const listEventTypes = createServerFn({ method: 'GET' })
  .validator(validateScope)
  .handler(async ({ data }) => {
    const { workspaceId } = await requireMember('read', data.workspace);
    const rows = await client<{ event_type: string; count: string }[]>`
      SELECT event_type, count(*) AS count FROM events WHERE workspace_id = ${workspaceId}
      GROUP BY event_type ORDER BY event_type
    `;
    return rows.map((row) => ({ eventType: row.event_type, count: Number(row.count) }));
  });

async function reviewQueue(workspaceId: string) {
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
    JOIN workspace_index_state ON workspace_index_state.workspace_id = concepts.workspace_id
      AND workspace_index_state.indexed_commit_sha = concepts.commit_sha
    WHERE concepts.workspace_id = ${workspaceId} AND concepts.status = 'stable'
    ORDER BY concepts.path
  `;
  return rows
    .map((row) => {
      const verifiedAt = revisionTime(row.frontmatter);
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

async function commitAndIndex(
  membership: Awaited<ReturnType<typeof requireMember>>,
  path: string,
  frontmatter: Record<string, unknown>,
  body: string,
  subject: string,
  eventType: string
) {
  const commit = await commitFiles({
    actor: actorName(membership.userId),
    corpusPath: corpusPath(),
    files: [{ path, text: serializeOkfDocument({ frontmatter, body: body.trim() }) }],
    subject,
    workspace: membership.slug,
  });
  const indexed = await indexWorkspace({
    corpusPath: corpusPath(),
    embeddingModel: embeddingModel(),
    embeddings: embeddings(),
    sql: indexClient,
    workspaceId: membership.workspaceId,
    workspaceSlug: membership.slug,
  });
  if (!indexed.indexed || indexed.commit !== commit)
    throw new Error('Concept commit was superseded before indexing completed');
  await client`
    INSERT INTO events (workspace_id, actor_admin_id, event_type, metadata)
    VALUES (${membership.workspaceId}, ${membership.userId}, ${eventType}, ${JSON.stringify({ path, commit })}::jsonb)
  `;
  return { chunks: indexed.chunks, commit, path };
}

export const createConcept = createServerFn({ method: 'POST' })
  .validator(
    (
      value: unknown
    ): Scoped<{ markdown: string; path: string; tags: string[]; title: string; type: string }> => {
      const input = value as Record<string, unknown>;
      const markdown = optionalText(input.markdown, 'Markdown');
      const title = optionalText(input.title, 'title');
      const type = optionalText(input.type, 'type');
      const path = typeof input.path === 'string' ? validateOkfPath(input.path) : null;
      if (!markdown || !title || !type || !path)
        throw new Error('A path, type, title, and Markdown are required.');
      return {
        workspace: validateWorkspace(value),
        markdown,
        path,
        tags: tags(input.tags),
        title,
        type,
      };
    }
  )
  .handler(async ({ data }) => {
    const membership = await requireMember('write', data.workspace);
    if ((await listConceptPaths(corpusPath(), membership.slug)).includes(data.path))
      throw new Error('A concept already exists at that path');
    const now = new Date().toISOString();
    return commitAndIndex(
      membership,
      data.path,
      {
        type: data.type,
        title: data.title,
        tags: data.tags,
        generated: { by: actorName(membership.userId), at: now },
        verified: [{ by: actorName(membership.userId), at: now }],
        commonwealth: { authority: 'approved' },
      },
      data.markdown,
      `Create ${data.path}`,
      'concept_created'
    );
  });

export const reviseConcept = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ markdown: string; path: string; title: string }> => {
    const input = value as Record<string, unknown>;
    const markdown = optionalText(input.markdown, 'Markdown');
    const title = optionalText(input.title, 'title');
    const path = typeof input.path === 'string' ? validateOkfPath(input.path) : null;
    if (!markdown || !title || !path) throw new Error('A path, title, and Markdown are required.');
    return { workspace: validateWorkspace(value), markdown, path, title };
  })
  .handler(async ({ data }) => {
    const membership = await requireMember('write', data.workspace);
    const text = await readFileAtCommit(corpusPath(), membership.slug, data.path);
    const document = parseOkfDocument(text);
    if (
      membership.role === 'writer' &&
      owner(document.frontmatter) !== actorName(membership.userId)
    )
      throw new Error('Writers can only revise concepts they created.');
    const now = new Date().toISOString();
    const verified = Array.isArray(document.frontmatter.verified)
      ? [...document.frontmatter.verified]
      : [];
    verified.push({ by: actorName(membership.userId), at: now });
    return commitAndIndex(
      membership,
      data.path,
      {
        ...document.frontmatter,
        title: data.title,
        generated: { by: actorName(membership.userId), at: now },
        verified,
      },
      data.markdown,
      `Revise ${data.path}`,
      'concept_revised'
    );
  });

export const verifyConcept = createServerFn({ method: 'POST' })
  .validator((value: unknown): Scoped<{ authority: Authority; path: string }> => {
    const input = value as Record<string, unknown>;
    const authority = optionalAuthority(input.authority);
    const path = typeof input.path === 'string' ? validateOkfPath(input.path) : null;
    if (!authority || !path) throw new Error('A path and authority are required.');
    return { workspace: validateWorkspace(value), authority, path };
  })
  .handler(async ({ data }) => {
    const membership = await requireMember('review', data.workspace);
    const text = await readFileAtCommit(corpusPath(), membership.slug, data.path);
    const document = parseOkfDocument(text);
    const verified = Array.isArray(document.frontmatter.verified)
      ? [...document.frontmatter.verified]
      : [];
    verified.push({ by: actorName(membership.userId), at: new Date().toISOString() });
    return commitAndIndex(
      membership,
      data.path,
      {
        ...document.frontmatter,
        verified,
        commonwealth: {
          ...(typeof document.frontmatter.commonwealth === 'object' &&
          document.frontmatter.commonwealth !== null
            ? document.frontmatter.commonwealth
            : {}),
          authority: data.authority,
        },
      },
      document.body,
      `Verify ${data.path}`,
      'concept_verified'
    );
  });

export const deprecateConcept = createServerFn({ method: 'POST' })
  .validator(pathInput)
  .handler(async ({ data }) => {
    const membership = await requireMember('review', data.workspace);
    const text = await readFileAtCommit(corpusPath(), membership.slug, data.path);
    const document = parseOkfDocument(text);
    return commitAndIndex(
      membership,
      data.path,
      { ...document.frontmatter, status: 'deprecated' },
      document.body,
      `Deprecate ${data.path}`,
      'concept_deprecated'
    );
  });
