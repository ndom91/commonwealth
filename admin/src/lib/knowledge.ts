import { createHash, randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { chunkMarkdown } from "@llm-team-kb/pipeline";
import { client } from "./db.js";
import { auth } from "./auth.js";
import { embeddingModel, embeddings } from "./pipeline.js";

/* Read and curation access to the knowledge corpus.
 *
 * Two things shape every query here:
 *
 * 1. `sources` has no title. Title and body live on `source_revisions`, so a
 *    source is only meaningful joined to its `current_revision_id`.
 * 2. The MCP layer filters every read to `status = 'active'`, which makes a
 *    withdrawn source invisible to the entire product. This surface is the only
 *    place one can be seen or restored, so `status` is a filter here, never a
 *    hardcoded predicate. */

const AUTHORITIES = ["unverified", "approved", "canonical"] as const;
const SOURCE_TYPES = ["note", "upload"] as const;
const STATUSES = ["active", "deleted", "failed"] as const;

type Authority = (typeof AUTHORITIES)[number];
type SourceType = (typeof SOURCE_TYPES)[number];
type Status = (typeof STATUSES)[number];

export const PAGE_SIZE = 40;

/* Staleness and the review queue are defined once and interpolated, because
   the rail count, the queue itself and the register's per-row flag must never
   disagree about what needs a human. Both fragments assume `sources` joined to
   `source_revisions AS revision` on `current_revision_id`.

   These are read-only queries on the pooled client, so a fragment built from
   `client` is the right handle. Inside a `client.begin()` block it would not
   be — see the note on transaction handles in management.ts. */
const IS_STALE = client`
  sources.last_verified_at IS NOT NULL
    AND revision.content_updated_at > sources.last_verified_at
`;

/* Two populations, not one: never vouched for, and vouched for then changed
   underneath. Both are content an agent is being served that no human stands
   behind. */
const NEEDS_REVIEW = client`
  sources.status = 'active'
    AND (sources.authority = 'unverified' OR (${IS_STALE}))
`;

async function adminId(): Promise<string> {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) throw new Error("Unauthorized");
  const [role] = await client<{ user_id: string }[]>`SELECT user_id FROM admin_role WHERE user_id = ${session.user.id}`;
  if (!role) throw new Error("Forbidden");
  return role.user_id;
}

function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`Invalid ${field}`);
  return value as T;
}

/* Shape-checked before it reaches SQL: the predicate casts to uuid, and a
   malformed value would surface as a database error rather than a rejected
   filter. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid ${field}`);
  return value;
}

/* Filters shared by the register and by keyword search. A query narrows the
   same register rather than replacing it, so both paths apply these
   identically. */
type SourceFilters = {
  authority: Authority | null;
  sourceType: SourceType | null;
  status: Status | null;
  submitter: string | null;
};

function validateFilters(input: Record<string, unknown>): SourceFilters {
  return {
    authority: optionalOneOf(input.authority, AUTHORITIES, "authority"),
    sourceType: optionalOneOf(input.sourceType, SOURCE_TYPES, "source type"),
    status: optionalOneOf(input.status, STATUSES, "status"),
    submitter: optionalId(input.submitter, "submitter"),
  };
}

type ListInput = SourceFilters & {
  /* Keyset cursor. Ordering is (created_at DESC, id DESC), so a page continues
     from the last row rather than an offset that shifts as agents submit. */
  cursor: { createdAt: string; id: string } | null;
};

function validateList(value: unknown): ListInput {
  const input = (value ?? {}) as Record<string, unknown>;
  const cursorInput = input.cursor as { createdAt?: string; id?: string } | undefined;
  let cursor: ListInput["cursor"] = null;
  if (cursorInput) {
    if (!cursorInput.createdAt || !cursorInput.id) throw new Error("Invalid cursor");
    cursor = { createdAt: cursorInput.createdAt, id: cursorInput.id };
  }
  return { ...validateFilters(input), cursor };
}

export const listSources = createServerFn({ method: "GET" })
  .validator(validateList)
  .handler(async ({ data }) => {
    await adminId();
    const rows = await client`
      SELECT sources.id, sources.source_type, sources.status, sources.authority,
             sources.created_at, sources.deleted_at, sources.last_verified_at,
             revision.title, revision.revision_number, revision.content_updated_at,
             COALESCE(author.display_name, 'administrator') AS author,
             COALESCE(
               (SELECT json_agg(source_tags.tag ORDER BY source_tags.tag)
                FROM source_tags WHERE source_tags.source_id = sources.id),
               '[]'
             ) AS tags,
             (${IS_STALE}) AS is_stale
      FROM sources
      JOIN source_revisions AS revision ON revision.id = sources.current_revision_id
      LEFT JOIN users AS author ON author.id = sources.created_by
      WHERE (${data.authority}::text IS NULL OR sources.authority = ${data.authority})
        AND (${data.sourceType}::text IS NULL OR sources.source_type = ${data.sourceType})
        AND (${data.status}::text IS NULL OR sources.status = ${data.status})
        AND (${data.submitter}::uuid IS NULL OR sources.created_by = ${data.submitter})
        AND (
          ${data.cursor?.createdAt ?? null}::timestamptz IS NULL
          OR (sources.created_at, sources.id)
             < (${data.cursor?.createdAt ?? null}::timestamptz, ${data.cursor?.id ?? null}::uuid)
        )
      ORDER BY sources.created_at DESC, sources.id DESC
      LIMIT ${PAGE_SIZE + 1}
    `;
    /* One row beyond the page tells us another page exists without a count(*)
       over the whole corpus. */
    const hasMore = rows.length > PAGE_SIZE;
    return { sources: rows.slice(0, PAGE_SIZE), hasMore };
  });

/* The review queue is two populations, not one: sources nobody has vouched for,
   and sources that changed after someone did. The second is the one a
   provenance product must not let slip. */
export const listReviewQueue = createServerFn({ method: "GET" }).handler(async () => {
  await adminId();
  const rows = await client`
    SELECT sources.id, sources.source_type, sources.authority, sources.created_at,
           sources.last_verified_at, revision.title, revision.revision_number,
           revision.content_updated_at, COALESCE(author.display_name, 'administrator') AS author,
           sources.authority = 'unverified' AS is_unverified,
           (${IS_STALE}) AS is_stale
    FROM sources
    JOIN source_revisions AS revision ON revision.id = sources.current_revision_id
    LEFT JOIN users AS author ON author.id = sources.created_by
    WHERE ${NEEDS_REVIEW}
    ORDER BY revision.content_updated_at DESC
    LIMIT 200
  `;
  return rows;
});

/* The rail shows a live count against each section. One round trip keeps the
   chrome consistent across routes instead of each page counting what it
   happens to have already fetched. */
export const getNavCounts = createServerFn({ method: "GET" }).handler(async () => {
  await adminId();
  const [row] = await client<{ identities: string; sources: string; review: string }[]>`
    SELECT
      (SELECT count(*) FROM users) AS identities,
      (SELECT count(*) FROM sources WHERE status = 'active') AS sources,
      (SELECT count(*)
       FROM sources
       JOIN source_revisions AS revision ON revision.id = sources.current_revision_id
       WHERE ${NEEDS_REVIEW}) AS review
  `;
  return {
    identities: Number(row?.identities ?? 0),
    sources: Number(row?.sources ?? 0),
    review: Number(row?.review ?? 0),
  };
});

function validateSourceId(value: unknown): { sourceId: string } {
  const sourceId = (value as { sourceId?: string })?.sourceId?.trim();
  if (!sourceId) throw new Error("Invalid source");
  return { sourceId };
}

export const getSourceDetail = createServerFn({ method: "GET" })
  .validator(validateSourceId)
  .handler(async ({ data }) => {
    await adminId();
    const [source] = await client`
      SELECT sources.id, sources.source_type, sources.status, sources.authority,
             sources.created_at, sources.deleted_at, sources.last_verified_at,
             sources.current_content_hash,
             revision.title, revision.revision_number, revision.markdown_content,
             revision.content_updated_at, revision.original_filename, revision.mime_type,
             COALESCE(author.display_name, 'administrator') AS author,
             COALESCE(
               (SELECT json_agg(source_tags.tag ORDER BY source_tags.tag)
                FROM source_tags WHERE source_tags.source_id = sources.id),
               '[]'
             ) AS tags,
             (${IS_STALE}) AS is_stale
      FROM sources
      JOIN source_revisions AS revision ON revision.id = sources.current_revision_id
      LEFT JOIN users AS author ON author.id = sources.created_by
      WHERE sources.id = ${data.sourceId}
    `;
    if (!source) throw new Error("That source no longer exists");
    return source;
  });

export const getSourceRevisions = createServerFn({ method: "GET" })
  .validator(validateSourceId)
  .handler(async ({ data }) => {
    await adminId();
    return client`
      SELECT source_revisions.id, source_revisions.revision_number,
             source_revisions.content_hash, source_revisions.content_updated_at,
             source_revisions.created_at, source_revisions.title,
             length(source_revisions.markdown_content) AS content_length,
             source_revisions.id = sources.current_revision_id AS is_current,
             COALESCE(author.display_name, 'administrator') AS author
      FROM source_revisions
      JOIN sources ON sources.id = source_revisions.source_id
      LEFT JOIN users AS author ON author.id = source_revisions.created_by
      WHERE source_revisions.source_id = ${data.sourceId}
      ORDER BY source_revisions.revision_number DESC
    `;
  });

/* Events the MCP server wrote before it moved to `sql.json` hold a JSON *string*
   inside the jsonb column rather than an object — see the note in db.ts on why
   the two packages encode jsonb differently. Those rows are history and cannot
   be rewritten, so reads unwrap them here. Anything neither an object nor
   parseable becomes `{}`: metadata is supplementary, and a malformed payload
   must not blank the custody line it annotates. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function eventMetadata(raw: unknown): Record<string, JsonValue> {
  if (raw && typeof raw === "object") return raw as Record<string, JsonValue>;
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, JsonValue>) : {};
  } catch {
    return {};
  }
}

export const getSourceEvents = createServerFn({ method: "GET" })
  .validator(validateSourceId)
  .handler(async ({ data }) => {
    await adminId();
    const rows = await client`
      SELECT events.id, events.event_type, events.metadata, events.created_at,
             actor.display_name AS actor
      FROM events
      LEFT JOIN users AS actor ON actor.id = events.actor_id
      WHERE events.source_id = ${data.sourceId}
      ORDER BY events.created_at DESC
      LIMIT 100
    `;
    return rows.map((row) => ({ ...row, metadata: eventMetadata(row.metadata) }));
  });

/* Every human review action moves last_verified_at. That timestamp is what the
   review queue measures staleness against, so a decision that did not record
   when it was made would leave the source permanently in the queue. */
export const setSourceAuthority = createServerFn({ method: "POST" })
  .validator((value: unknown): { sourceId: string; authority: Authority } => {
    const input = value as Partial<{ sourceId: string; authority: string }>;
    if (!input.sourceId?.trim()) throw new Error("Invalid source");
    if (!AUTHORITIES.includes(input.authority as Authority)) throw new Error("Invalid authority");
    return { sourceId: input.sourceId.trim(), authority: input.authority as Authority };
  })
  .handler(async ({ data }) => {
    const administrator = await adminId();
    await client.begin(async (transaction) => {
      const [source] = await transaction<{ workspace_id: string; authority: string }[]>`
        SELECT workspace_id, authority FROM sources WHERE id = ${data.sourceId}
      `;
      if (!source) throw new Error("That source no longer exists");
      await transaction`
        UPDATE sources
        SET authority = ${data.authority}, last_verified_at = now()
        WHERE id = ${data.sourceId}
      `;
      if (source.authority !== data.authority) {
        await transaction`
          INSERT INTO events (workspace_id, actor_admin_id, event_type, source_id, metadata)
          VALUES (${source.workspace_id}, ${administrator}, 'source_authority_changed', ${data.sourceId},
            ${JSON.stringify({ authority: data.authority, from: source.authority })}::jsonb)
        `;
      }
    });
    return { sourceId: data.sourceId, authority: data.authority };
  });

export const withdrawSource = createServerFn({ method: "POST" })
  .validator(validateSourceId)
  .handler(async ({ data }) => {
    const administrator = await adminId();
    await client.begin(async (transaction) => {
      const [source] = await transaction<{ workspace_id: string; status: string }[]>`
        SELECT workspace_id, status FROM sources WHERE id = ${data.sourceId}
      `;
      if (!source) throw new Error("That source no longer exists");
      if (source.status === "deleted") return;
      await transaction`
        UPDATE sources SET status = 'deleted', deleted_at = now() WHERE id = ${data.sourceId}
      `;
      await transaction`
        INSERT INTO events (workspace_id, actor_admin_id, event_type, source_id, metadata)
        VALUES (${source.workspace_id}, ${administrator}, 'source_deleted', ${data.sourceId}, '{}'::jsonb)
      `;
    });
    return { sourceId: data.sourceId, status: "deleted" as const };
  });

/* Restoring is the counterpart the MCP layer never had — deleteSource is
   one-way there. It can legitimately fail: a partial unique index enforces one
   active source per content hash per workspace, so if an identical source was
   submitted while this one was withdrawn, the restore collides. That is a real
   answer, not an internal error, so it is reported as one. */
export const restoreSource = createServerFn({ method: "POST" })
  .validator(validateSourceId)
  .handler(async ({ data }) => {
    const administrator = await adminId();
    try {
      await client.begin(async (transaction) => {
        const [source] = await transaction<{ workspace_id: string; status: string }[]>`
          SELECT workspace_id, status FROM sources WHERE id = ${data.sourceId}
        `;
        if (!source) throw new Error("That source no longer exists");
        if (source.status === "active") return;
        await transaction`
          UPDATE sources SET status = 'active', deleted_at = NULL WHERE id = ${data.sourceId}
        `;
        await transaction`
          INSERT INTO events (workspace_id, actor_admin_id, event_type, source_id, metadata)
          VALUES (${source.workspace_id}, ${administrator}, 'source_restored', ${data.sourceId}, '{}'::jsonb)
        `;
      });
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      if (code === "23505") {
        throw new Error(
          "An active source with identical content already exists. Withdraw that one first, or leave this one withdrawn",
        );
      }
      throw cause;
    }
    return { sourceId: data.sourceId, status: "active" as const };
  });

/* The workspace-wide event log.
 *
 * Two actor columns, never both set: `actor_id` names the agent identity that
 * acted over MCP, `actor_admin_id` the signed-in administrator who acted here.
 * Rows written before 0004 carry neither, which reads as "unattributed" rather
 * than being hidden — the log is append-only and does not get retconned. */
export const listEvents = createServerFn({ method: "GET" })
  .validator((value: unknown): { eventType: string | null; cursor: { createdAt: string; id: string } | null } => {
    const input = (value ?? {}) as Partial<{ eventType: string; cursor: { createdAt?: string; id?: string } }>;
    let cursor: { createdAt: string; id: string } | null = null;
    if (input.cursor) {
      if (!input.cursor.createdAt || !input.cursor.id) throw new Error("Invalid cursor");
      cursor = { createdAt: input.cursor.createdAt, id: input.cursor.id };
    }
    const eventType = input.eventType?.trim() || null;
    /* An allowlist would go stale every time a new event type is written, so
       the shape is constrained instead: the filter is matched exactly against
       a column, and anything that is not a bare event-type token is refused. */
    if (eventType && !/^[a-z_]{1,64}$/.test(eventType)) throw new Error("Invalid event type");
    return { eventType, cursor };
  })
  .handler(async ({ data }) => {
    await adminId();
    const rows = await client`
      SELECT events.id, events.event_type, events.metadata, events.created_at,
             events.source_id, revision.title AS source_title,
             agent.display_name AS actor_agent,
             administrator.email AS actor_admin
      FROM events
      LEFT JOIN users AS agent ON agent.id = events.actor_id
      LEFT JOIN "user" AS administrator ON administrator.id = events.actor_admin_id
      LEFT JOIN sources ON sources.id = events.source_id
      LEFT JOIN source_revisions AS revision ON revision.id = sources.current_revision_id
      WHERE (${data.eventType}::text IS NULL OR events.event_type = ${data.eventType})
        AND (
          ${data.cursor?.createdAt ?? null}::timestamptz IS NULL
          OR (events.created_at, events.id)
             < (${data.cursor?.createdAt ?? null}::timestamptz, ${data.cursor?.id ?? null}::uuid)
        )
      ORDER BY events.created_at DESC, events.id DESC
      LIMIT ${PAGE_SIZE + 1}
    `;
    return {
      events: rows.slice(0, PAGE_SIZE).map((row) => ({ ...row, metadata: eventMetadata(row.metadata) })),
      hasMore: rows.length > PAGE_SIZE,
    };
  });

/* The distinct event types actually present, so the filter offers what this
   workspace has rather than a hardcoded list that drifts from the writers. */
export const listEventTypes = createServerFn({ method: "GET" }).handler(async () => {
  await adminId();
  const rows = await client<{ event_type: string; count: string }[]>`
    SELECT event_type, count(*) AS count FROM events GROUP BY event_type ORDER BY event_type
  `;
  return rows.map((row) => ({ eventType: row.event_type, count: Number(row.count) }));
});

/* Keyword search over the corpus.
 *
 * This is lexical only, and the UI must say so. Agents get hybrid semantic +
 * lexical ranking through `search_knowledge`; the query vector for the semantic
 * half comes from Ollama, which the admin service cannot reach — it has only
 * DATABASE_URL. Presenting these results as "search" without qualification
 * would misrepresent what an agent actually retrieves.
 *
 * Two ways to match, because they fail in opposite directions:
 *
 * 1. Title substring. Full-text search matches whole stemmed words, so typing
 *    "escala" finds nothing — "escalation" is indexed as the stem "escal", and
 *    a prefix query on "escala" cannot reach it. Anyone half-remembering a
 *    title types a fragment, so titles are matched by plain substring.
 *    `strpos` rather than ILIKE: no wildcard characters to escape.
 * 2. Body keywords. `chunks.search_vector` is a generated tsvector with a GIN
 *    index, so this costs nothing beyond the query. ts_rank_cd rewards matches
 *    that sit close together, and the best-scoring chunk stands for its source.
 *
 * A title hit outranks any body hit: naming the thing you want is a stronger
 * signal than mentioning it. Matched body terms come back wrapped in STX/ETX
 * control characters rather than markup. The client splits on them and renders
 * each piece as a React child, so the highlight is real but no part of the body
 * is ever parsed as HTML — the same rule the source bench follows.
 *
 * The register's filters apply here too. A query narrows the register rather
 * than replacing it: "everything this agent submitted, about deployments" is a
 * question people actually have, and answering only half of it would send them
 * to scroll a ranked list by eye. */
export const searchSources = createServerFn({ method: "GET" })
  .validator((value: unknown): SourceFilters & { query: string } => {
    const input = (value ?? {}) as Record<string, unknown>;
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) throw new Error("Enter something to search for");
    if (query.length > 200) throw new Error("That search is too long");
    return { ...validateFilters(input), query };
  })
  .handler(async ({ data }) => {
    await adminId();
    return client`
      WITH terms AS (SELECT websearch_to_tsquery('english', ${data.query}) AS value)
      SELECT sources.id, sources.authority, sources.source_type, sources.status,
             sources.last_verified_at, revision.title, revision.revision_number,
             revision.content_updated_at, COALESCE(author.display_name, 'administrator') AS author,
             (${IS_STALE}) AS is_stale,
             body.excerpt,
             strpos(lower(revision.title), lower(${data.query})) > 0 AS title_match
      FROM sources
      JOIN source_revisions AS revision ON revision.id = sources.current_revision_id
      LEFT JOIN users AS author ON author.id = sources.created_by
      CROSS JOIN terms
      LEFT JOIN LATERAL (
        SELECT max(ts_rank_cd(chunks.search_vector, terms.value)) AS rank,
               ts_headline('english',
                 (array_agg(chunks.content ORDER BY
                    ts_rank_cd(chunks.search_vector, terms.value) DESC))[1],
                 terms.value,
                 'MaxFragments=1, MaxWords=28, MinWords=12,
                  StartSel=\x02, StopSel=\x03') AS excerpt
        FROM chunks
        WHERE chunks.source_revision_id = revision.id
          AND chunks.search_vector @@ terms.value
        GROUP BY terms.value
      ) AS body ON true
      WHERE (${data.status}::text IS NULL OR sources.status = ${data.status})
        AND (${data.authority}::text IS NULL OR sources.authority = ${data.authority})
        AND (${data.sourceType}::text IS NULL OR sources.source_type = ${data.sourceType})
        AND (${data.submitter}::uuid IS NULL OR sources.created_by = ${data.submitter})
        AND (body.rank IS NOT NULL OR strpos(lower(revision.title), lower(${data.query})) > 0)
      ORDER BY (strpos(lower(revision.title), lower(${data.query})) > 0) DESC,
               body.rank DESC NULLS LAST,
               revision.content_updated_at DESC
      LIMIT 25
    `;
  });

/* Identities that have submitted at least one source, for the register's
   submitter filter. Counts every status, not just active: a submitter whose
   only sources were withdrawn must stay selectable, or the Withdrawn status
   filter has nobody to combine with. */
export const listSubmitters = createServerFn({ method: "GET" }).handler(async () => {
  await adminId();
  const rows = await client<{ id: string; name: string; count: string }[]>`
    SELECT users.id, users.display_name AS name, count(*) AS count
    FROM sources
    JOIN users ON users.id = sources.created_by
    GROUP BY users.id, users.display_name
    ORDER BY users.display_name
  `;
  return rows.map((row) => ({ id: row.id, name: row.name, count: Number(row.count) }));
});

/* Authoring — the one thing the review queue could not do.
 *
 * `/review` names sources a human should look at, and until this the bench
 * could only pass judgement on them: approve, unverify, withdraw. A reviewer
 * who saw a mistake in a canonical source had to go and ask an agent to fix it.
 *
 * The work deliberately splits either side of the transaction. Chunking and
 * embedding run first, outside it, because embedding is a network round trip to
 * Ollama and holding `FOR UPDATE` on the source across it would block every
 * agent writing to that same source for the duration. This mirrors how
 * `prepareContent` is called before `sql.begin` in the MCP server.
 *
 * Chunks are inserted, never deleted. They are keyed to the revision that
 * produced them, and retrieval reaches them through
 * `sources.current_revision_id`, so superseded chunks fall out of search by
 * construction while the old revision stays readable — principle 2, nothing in
 * the product may make history unrecoverable. */
export const reviseSource = createServerFn({ method: "POST" })
  .validator((value: unknown): { sourceId: string; title: string; markdown: string } => {
    const input = (value ?? {}) as Partial<{ sourceId: string; title: string; markdown: string }>;
    const sourceId = input.sourceId?.trim();
    if (!sourceId || !UUID.test(sourceId)) throw new Error("Invalid source");
    const title = input.title?.trim();
    if (!title) throw new Error("A revision needs a title.");
    const markdown = input.markdown?.trim();
    if (!markdown) throw new Error("A revision cannot be empty.");
    return { sourceId, title, markdown };
  })
  .handler(async ({ data }) => {
    const administrator = await adminId();

    const chunks = chunkMarkdown(data.markdown);
    if (chunks.length === 0) throw new Error("That text contains nothing indexable.");
    const contentHash = createHash("sha256").update(data.markdown).digest("hex");
    const vectors = await embeddings().embed(chunks.map((chunk) => chunk.content));
    const model = embeddingModel();

    try {
      return await client.begin(async (transaction) => {
        const [source] = await transaction<
          { workspace_id: string; current_revision_id: string; source_type: string; status: string }[]
        >`
          SELECT workspace_id, current_revision_id, source_type, status
          FROM sources WHERE id = ${data.sourceId} FOR UPDATE
        `;
        if (!source) throw new Error("That source no longer exists");
        if (source.status !== "active") {
          throw new Error("Restore this source before revising it");
        }
        /* Same rule the MCP server enforces: an upload's revision carries the
           converted text of a stored file, so replacing the text alone would
           leave the two disagreeing about what the source is. */
        if (source.source_type === "upload") {
          throw new Error("Uploaded sources cannot be revised as Markdown. Withdraw it and upload a corrected file");
        }

        const [current] = await transaction<{ revision_number: number; content_hash: string }[]>`
          SELECT revision_number, content_hash FROM source_revisions WHERE id = ${source.current_revision_id}
        `;
        if (!current) throw new Error("That source has no current revision");
        if (current.content_hash === contentHash) throw new Error("Nothing changed in that text");

        const revisionNumber = current.revision_number + 1;
        const [revision] = await transaction<{ id: string }[]>`
          INSERT INTO source_revisions (
            source_id, revision_number, title, content_hash, markdown_content,
            supersedes_revision_id, created_by, created_by_admin_id
          ) VALUES (
            ${data.sourceId}, ${revisionNumber}, ${data.title}, ${contentHash}, ${data.markdown},
            ${source.current_revision_id}, NULL, ${administrator}
          ) RETURNING id
        `;
        if (!revision) throw new Error("Unable to record the revision");

        for (const [ordinal, chunk] of chunks.entries()) {
          await transaction`
            INSERT INTO chunks (source_id, source_revision_id, ordinal, heading, content, token_count, embedding, embedding_model)
            VALUES (${data.sourceId}, ${revision.id}, ${ordinal}, ${chunk.heading}, ${chunk.content},
                    ${chunk.tokenCount}, ${`[${vectors[ordinal]!.join(",")}]`}::vector, ${model})
          `;
        }

        /* A person who rewrites the text is vouching for it by the act, so
           verification moves with the revision. Without this the source would
           reappear in the review queue immediately, stale against a version the
           reviewer had just written themselves. Authority is untouched: writing
           is not the same as promoting. */
        await transaction`
          UPDATE sources
          SET current_revision_id = ${revision.id}, current_content_hash = ${contentHash},
              last_verified_at = now()
          WHERE id = ${data.sourceId}
        `;

        await transaction`
          INSERT INTO events (workspace_id, actor_admin_id, event_type, source_id, metadata)
          VALUES (${source.workspace_id}, ${administrator}, 'source_revised', ${data.sourceId},
            ${JSON.stringify({
              previousRevisionId: source.current_revision_id,
              revisionId: revision.id,
              revisionNumber,
              chunkCount: chunks.length,
            })}::jsonb)
        `;

        return { sourceId: data.sourceId, revisionNumber, chunkCount: chunks.length };
      });
    } catch (cause) {
      if ((cause as { code?: string })?.code === "23505") {
        throw new Error(
          "Another active source already holds exactly this content. Withdraw that one first, or make this revision differ from it",
        );
      }
      throw cause;
    }
  });

/* Creating a source from the browser, the other half of authoring.
 *
 * Lands `approved` with `last_verified_at` set, rather than `unverified` like an
 * agent submission. The queue exists to get a human to look at text nobody has
 * vouched for; text a human just wrote does not qualify, and putting it there
 * would ask them to review their own writing. Canonical stays a separate,
 * deliberate act — the same line trusted holders are held to.
 *
 * The two ids are generated up front because `sources.current_revision_id` and
 * `source_revisions.source_id` point at each other. Migration 0004 defers that
 * constraint precisely so the pair can be written in one transaction. */
export const createSource = createServerFn({ method: "POST" })
  .validator((value: unknown): { title: string; markdown: string; tags: string[] } => {
    const input = (value ?? {}) as Partial<{ title: string; markdown: string; tags: unknown }>;
    const title = input.title?.trim();
    if (!title) throw new Error("A source needs a title.");
    const markdown = input.markdown?.trim();
    if (!markdown) throw new Error("A source cannot be empty.");
    const tags = Array.isArray(input.tags)
      ? [...new Set(input.tags.map((tag) => String(tag).trim()).filter(Boolean))]
      : [];
    return { title, markdown, tags };
  })
  .handler(async ({ data }) => {
    const administrator = await adminId();

    const chunks = chunkMarkdown(data.markdown);
    if (chunks.length === 0) throw new Error("That text contains nothing indexable.");
    const contentHash = createHash("sha256").update(data.markdown).digest("hex");
    const vectors = await embeddings().embed(chunks.map((chunk) => chunk.content));
    const model = embeddingModel();

    const sourceId = randomUUID();
    const revisionId = randomUUID();

    try {
      return await client.begin(async (transaction) => {
        const [workspace] = await transaction<{ id: string }[]>`
          SELECT id FROM workspaces WHERE name = 'default'
        `;
        if (!workspace) throw new Error("Default workspace is unavailable");

        await transaction`
          INSERT INTO sources (
            id, workspace_id, source_type, authority, current_revision_id,
            current_content_hash, created_by, created_by_admin_id, last_verified_at
          ) VALUES (
            ${sourceId}, ${workspace.id}, 'note', 'approved', ${revisionId},
            ${contentHash}, NULL, ${administrator}, now()
          )
        `;

        await transaction`
          INSERT INTO source_revisions (
            id, source_id, revision_number, title, content_hash, markdown_content,
            supersedes_revision_id, created_by, created_by_admin_id
          ) VALUES (
            ${revisionId}, ${sourceId}, 1, ${data.title}, ${contentHash}, ${data.markdown},
            NULL, NULL, ${administrator}
          )
        `;

        for (const [ordinal, chunk] of chunks.entries()) {
          await transaction`
            INSERT INTO chunks (source_id, source_revision_id, ordinal, heading, content, token_count, embedding, embedding_model)
            VALUES (${sourceId}, ${revisionId}, ${ordinal}, ${chunk.heading}, ${chunk.content},
                    ${chunk.tokenCount}, ${`[${vectors[ordinal]!.join(",")}]`}::vector, ${model})
          `;
        }

        for (const tag of data.tags) {
          await transaction`INSERT INTO source_tags (source_id, tag) VALUES (${sourceId}, ${tag})`;
        }

        await transaction`
          INSERT INTO events (workspace_id, actor_admin_id, event_type, source_id, metadata)
          VALUES (${workspace.id}, ${administrator}, 'source_submitted', ${sourceId},
            ${JSON.stringify({ sourceType: "note", authority: "approved", revisionId, chunkCount: chunks.length })}::jsonb)
        `;

        return { sourceId, chunkCount: chunks.length };
      });
    } catch (cause) {
      if ((cause as { code?: string })?.code === "23505") {
        throw new Error(
          "An active source already holds exactly this content. Open that one and revise it instead of creating a duplicate",
        );
      }
      throw cause;
    }
  });
