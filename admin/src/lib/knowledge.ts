import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { client } from "./db.js";
import { auth } from "./auth.js";

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

type ListInput = {
  authority: Authority | null;
  sourceType: SourceType | null;
  status: Status | null;
  /* Keyset cursor. Ordering is (created_at DESC, id DESC), so a page continues
     from the last row rather than an offset that shifts as agents submit. */
  cursor: { createdAt: string; id: string } | null;
};

function validateList(value: unknown): ListInput {
  const input = (value ?? {}) as Partial<{
    authority: string;
    sourceType: string;
    status: string;
    cursor: { createdAt?: string; id?: string };
  }>;
  let cursor: ListInput["cursor"] = null;
  if (input.cursor) {
    if (!input.cursor.createdAt || !input.cursor.id) throw new Error("Invalid cursor");
    cursor = { createdAt: input.cursor.createdAt, id: input.cursor.id };
  }
  return {
    authority: optionalOneOf(input.authority, AUTHORITIES, "authority"),
    sourceType: optionalOneOf(input.sourceType, SOURCE_TYPES, "source type"),
    status: optionalOneOf(input.status, STATUSES, "status"),
    cursor,
  };
}

export const listSources = createServerFn({ method: "GET" })
  .validator(validateList)
  .handler(async ({ data }) => {
    await adminId();
    const rows = await client`
      SELECT sources.id, sources.source_type, sources.status, sources.authority,
             sources.created_at, sources.deleted_at, sources.last_verified_at,
             revision.title, revision.revision_number, revision.content_updated_at,
             author.display_name AS author,
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
           revision.content_updated_at, author.display_name AS author,
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
             author.display_name AS author,
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
             author.display_name AS author
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
 * is ever parsed as HTML — the same rule the source bench follows. */
export const searchSources = createServerFn({ method: "GET" })
  .validator((value: unknown): { query: string } => {
    const query = (value as { query?: string })?.query?.trim();
    if (!query) throw new Error("Enter something to search for");
    if (query.length > 200) throw new Error("That search is too long");
    return { query };
  })
  .handler(async ({ data }) => {
    await adminId();
    return client`
      WITH terms AS (SELECT websearch_to_tsquery('english', ${data.query}) AS value)
      SELECT sources.id, sources.authority, sources.source_type, sources.status,
             sources.last_verified_at, revision.title, revision.revision_number,
             revision.content_updated_at, author.display_name AS author,
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
      WHERE sources.status = 'active'
        AND (body.rank IS NOT NULL OR strpos(lower(revision.title), lower(${data.query})) > 0)
      ORDER BY (strpos(lower(revision.title), lower(${data.query})) > 0) DESC,
               body.rank DESC NULLS LAST,
               revision.content_updated_at DESC
      LIMIT 25
    `;
  });
