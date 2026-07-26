import { createHash, randomUUID } from "node:crypto";
import postgres, { type JSONValue, type Sql, type TransactionSql } from "postgres";
import { chunkMarkdown, DocumentIngestion, type Embeddings } from "@llm-team-kb/pipeline";
import { requirePermission } from "./access-service.js";
import type { Config } from "./config.js";
import type { Actor, Authority, SearchInput, SourceType } from "./domain.js";
import { DomainError } from "./errors.js";
type SourceRow = {
  id: string;
  created_by: string;
  current_revision_id: string;
  title: string;
  source_type: SourceType;
  authority: Authority;
};
type RevisionInput = {
  title: string;
  markdown: string;
  contentHash?: string;
  originalFilename?: string;
  mimeType?: string;
  storagePath?: string;
};
type PreparedContent = {
  markdown: string;
  contentHash: string;
  chunks: ReturnType<typeof chunkMarkdown>;
  vectors: number[][];
};
type PreparedRevision = Omit<RevisionInput, "contentHash" | "markdown"> & PreparedContent;

export class KnowledgeRepository {
  readonly sql: Sql;

  constructor(
    private readonly config: Config,
    private readonly embeddings: Pick<Embeddings, "embed">,
    private readonly documentIngestion = new DocumentIngestion({
      markitdownUrl: config.MARKITDOWN_URL,
      storagePath: config.SOURCE_STORAGE_PATH,
      maxUploadBytes: config.MAX_UPLOAD_BYTES,
    }),
  ) {
    this.sql = postgres(config.DATABASE_URL);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async submitNote(actor: Actor, input: { title: string; markdown: string; tags: string[] }): Promise<{ id: string; revisionNumber: number; chunkCount: number }> {
    requirePermission(actor, "write");
    return this.createSource(actor, { ...input, sourceType: "note" });
  }

  async submitDocument(actor: Actor, input: { title: string; filename: string; mimeType: string; bytes: Uint8Array; tags: string[] }): Promise<{ id: string; revisionNumber: number; chunkCount: number }> {
    requirePermission(actor, "write");
    const document = await this.documentIngestion.ingest(input);

    try {
      return await this.createSource(actor, {
        title: input.title,
        markdown: document.markdown,
        tags: input.tags,
        sourceType: "upload",
        originalFilename: input.filename,
        mimeType: input.mimeType,
        storagePath: document.storagePath,
        contentHash: document.contentHash,
      });
    } catch (error) {
      console.error("Document indexing failed; retaining content-addressed blob for safe cleanup", error);
      throw error;
    }
  }

  async updateSource(actor: Actor, sourceId: string, input: { markdown: string; title?: string; tags?: string[] }): Promise<{ id: string; revisionNumber: number; chunkCount: number }> {
    requirePermission(actor, "write");
    const content = await this.prepareContent(input.markdown);
    return this.sql.begin(async (transaction) => {
      const [source] = await transaction<SourceRow[]>`
        SELECT sources.id, sources.created_by, sources.current_revision_id, source_revisions.title,
               sources.source_type, sources.authority
        FROM sources JOIN source_revisions ON source_revisions.id = sources.current_revision_id
        WHERE sources.id = ${sourceId} AND sources.workspace_id = ${actor.workspaceId} AND sources.status = 'active'
        FOR UPDATE OF sources
      `;
      if (!source) throw new DomainError("Source not found");
      if (actor.role === "writer" && source.created_by !== actor.id) {
        throw new DomainError("Writers can only revise sources they created");
      }
      if (source.source_type === "upload") {
        throw new DomainError("Uploaded sources require binary replacement; Markdown revisions are not supported yet");
      }
      /* A trusted holder is exempt from the reviewer gate, otherwise trusting a
         writer would promote its first submission to approved and then lock
         that same agent out of revising it. The writer `created_by` check above
         still applies, so a trusted writer may only revise its own work. */
      if (
        source.authority !== "unverified" &&
        !actor.autoApprove &&
        actor.role !== "reviewer" &&
        actor.role !== "admin"
      ) {
        throw new DomainError("Reviewer access is required to revise approved or canonical sources");
      }

      const revision = this.prepareRevision(content, { title: input.title ?? source.title });

      const [currentRevision] = await transaction<{ revision_number: number; content_hash: string }[]>`
        SELECT revision_number, content_hash
        FROM source_revisions WHERE id = ${source.current_revision_id}
      `;
      if (!currentRevision) throw new DomainError("Source has no current revision");
      if (currentRevision.content_hash === revision.contentHash) {
        throw new DomainError("Revision content matches the current source revision");
      }

      const nextRevisionNumber = currentRevision.revision_number + 1;
      const revisionId = await this.insertRevision(transaction, source.id, randomUUID(), nextRevisionNumber, source.current_revision_id, actor, revision);
      /* A trusted holder vouches for what they write, but trust only ever raises
         standing: an already approved or canonical source keeps its authority and
         merely has its verification moved forward. */
      const promoted = actor.autoApprove && source.authority === "unverified";
      await transaction`
        UPDATE sources SET current_revision_id = ${revisionId}, current_content_hash = ${revision.contentHash},
          authority = ${promoted ? "approved" : source.authority},
          last_verified_at = CASE WHEN ${actor.autoApprove}::boolean THEN now() ELSE last_verified_at END
        WHERE id = ${source.id}
      `;
      if (input.tags !== undefined) await this.replaceTags(transaction, source.id, input.tags);
      await transaction`
        INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
        VALUES (${actor.workspaceId}, ${actor.id}, 'source_revised', ${source.id},
          ${transaction.json({ previousRevisionId: source.current_revision_id, revisionId, revisionNumber: nextRevisionNumber })})
      `;
      /* Only an actual transition is an authority change. Refreshing
         last_verified_at on a source that was already vouched for is not one. */
      if (promoted) {
        await transaction`
          INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
          VALUES (${actor.workspaceId}, ${actor.id}, 'source_authority_changed', ${source.id},
            ${transaction.json({ authority: "approved", auto: true })})
        `;
      }
      return { id: source.id, revisionNumber: nextRevisionNumber, chunkCount: revision.chunks.length };
    });
  }

  async search(actor: Actor, input: SearchInput): Promise<unknown[]> {
    requirePermission(actor, "read");
    const [embedding] = await this.embeddings.embed([input.query]);
    if (!embedding) throw new Error("Embedding provider returned no query embedding");
    const vector = toVector(embedding);
    const tags = input.tags.length === 0 ? null : input.tags;
    const candidateLimit = Math.max(input.limit * 10, 50);
    const rows = await this.sql<Record<string, unknown>[]>`
      WITH query_terms AS (
        SELECT websearch_to_tsquery('english', ${input.query}) AS value
      ), eligible_current_chunks AS NOT MATERIALIZED (
        SELECT chunks.id, chunks.embedding, chunks.search_vector
        FROM chunks JOIN source_revisions ON source_revisions.id = chunks.source_revision_id
        JOIN sources ON sources.current_revision_id = source_revisions.id
        WHERE sources.workspace_id = ${actor.workspaceId} AND sources.status = 'active'
          AND (${tags}::text[] IS NULL OR EXISTS (
            SELECT 1 FROM source_tags WHERE source_tags.source_id = sources.id AND source_tags.tag = ANY(${tags}::text[])
          ))
          AND (${input.sourceType ?? null}::text IS NULL OR sources.source_type = ${input.sourceType ?? null})
          AND (${input.authority ?? null}::text IS NULL OR sources.authority = ${input.authority ?? null})
          AND (${input.authorId ?? null}::uuid IS NULL OR source_revisions.created_by = ${input.authorId ?? null})
          AND (${input.updatedAfter ?? null}::timestamptz IS NULL OR source_revisions.content_updated_at >= ${input.updatedAfter ?? null}::timestamptz)
      ), vector_candidates AS (
        SELECT id FROM eligible_current_chunks
        ORDER BY embedding <=> ${vector}::vector LIMIT ${candidateLimit}
      ), lexical_candidates AS (
        SELECT eligible_current_chunks.id
        FROM eligible_current_chunks CROSS JOIN query_terms
        WHERE eligible_current_chunks.search_vector @@ query_terms.value
        ORDER BY ts_rank_cd(eligible_current_chunks.search_vector, query_terms.value) DESC LIMIT ${candidateLimit}
      ), candidate_ids AS (
        SELECT id FROM vector_candidates
        UNION
        SELECT id FROM lexical_candidates
      )
        SELECT chunks.id, chunks.content, chunks.heading, sources.id AS source_id, source_revisions.title,
             sources.source_type, sources.authority, source_revisions.revision_number,
             source_revisions.content_updated_at, users.id AS author_id,
             COALESCE(users.display_name, 'administrator') AS author,
             1 - (chunks.embedding <=> ${vector}::vector) AS semantic_score,
             ts_rank_cd(chunks.search_vector, query_terms.value) AS keyword_score,
             CASE sources.authority WHEN 'canonical' THEN 0.06 WHEN 'approved' THEN 0.03 ELSE 0 END AS authority_boost,
             CASE WHEN source_revisions.content_updated_at > now() - interval '90 days' THEN 0.02 ELSE 0 END AS freshness_boost,
             (1 - (chunks.embedding <=> ${vector}::vector)) * 0.78 +
             LEAST(ts_rank_cd(chunks.search_vector, query_terms.value), 1) * 0.14 +
             CASE sources.authority WHEN 'canonical' THEN 0.06 WHEN 'approved' THEN 0.03 ELSE 0 END +
             CASE WHEN source_revisions.content_updated_at > now() - interval '90 days' THEN 0.02 ELSE 0 END AS final_score
      FROM candidate_ids
      JOIN chunks ON chunks.id = candidate_ids.id
      JOIN source_revisions ON source_revisions.id = chunks.source_revision_id
      JOIN sources ON sources.current_revision_id = source_revisions.id
      /* LEFT, because created_by is null on revisions written by a human
         administrator from the browser. An inner join here would not error - it
         would drop the row, so a source a human had just corrected would go
         missing from every agent search result and nothing would say why.
         The same applies to getSource and getSourceHistory below. */
      LEFT JOIN users ON users.id = source_revisions.created_by
      CROSS JOIN query_terms
      ORDER BY final_score DESC, source_revisions.content_updated_at DESC, chunks.id
      LIMIT ${input.limit}
    `;
    await this.event(actor, "search", null, { query: input.query, resultCount: rows.length }).catch((error) => {
      console.error("Unable to record search event", error);
    });
    return rows.map((row) => formatSearchResult(row, input.explain));
  }

  async getSource(actor: Actor, sourceId: string, revisionNumber?: number): Promise<unknown> {
    requirePermission(actor, "read");
    const [source] = await this.sql`
      SELECT sources.id, source_revisions.title, sources.source_type, sources.authority,
             source_revisions.revision_number, source_revisions.markdown_content,
             source_revisions.content_updated_at, source_revisions.original_filename,
             source_revisions.mime_type, sources.last_verified_at,
             COALESCE(users.display_name, 'administrator') AS created_by
      FROM sources
      JOIN source_revisions ON source_revisions.source_id = sources.id
        AND (${revisionNumber ?? null}::integer IS NULL AND source_revisions.id = sources.current_revision_id
          OR source_revisions.revision_number = ${revisionNumber ?? null})
      LEFT JOIN users ON users.id = source_revisions.created_by
      WHERE sources.id = ${sourceId} AND sources.workspace_id = ${actor.workspaceId} AND sources.status = 'active'
    `;
    if (!source) throw new DomainError("Source not found");
    return source;
  }

  async getSourceHistory(actor: Actor, sourceId: string): Promise<unknown[]> {
    requirePermission(actor, "read");
    const revisions = await this.sql`
      SELECT source_revisions.id, source_revisions.revision_number, source_revisions.content_hash,
             source_revisions.content_updated_at, source_revisions.created_at,
             source_revisions.id = sources.current_revision_id AS is_current,
             COALESCE(users.display_name, 'administrator') AS created_by
      FROM sources
      JOIN source_revisions ON source_revisions.source_id = sources.id
      LEFT JOIN users ON users.id = source_revisions.created_by
      WHERE sources.id = ${sourceId} AND sources.workspace_id = ${actor.workspaceId} AND sources.status = 'active'
      ORDER BY source_revisions.revision_number DESC
    `;
    if (revisions.length === 0) throw new DomainError("Source not found");
    return revisions;
  }

  async setAuthority(actor: Actor, sourceId: string, authority: Authority): Promise<void> {
    requirePermission(actor, "review");
    await this.sql.begin(async (transaction) => {
      const updated = await transaction`
        UPDATE sources SET authority = ${authority}
        WHERE id = ${sourceId} AND workspace_id = ${actor.workspaceId} AND status = 'active' RETURNING id
      `;
      if (updated.length === 0) throw new Error("Source not found");
      await transaction`
        INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
        VALUES (${actor.workspaceId}, ${actor.id}, 'source_authority_changed', ${sourceId}, ${transaction.json({ authority })})
      `;
    });
  }

  async deleteSource(actor: Actor, sourceId: string): Promise<void> {
    requirePermission(actor, "review");
    await this.sql.begin(async (transaction) => {
      const updated = await transaction`
        UPDATE sources SET status = 'deleted', deleted_at = now()
        WHERE id = ${sourceId} AND workspace_id = ${actor.workspaceId} AND status = 'active' RETURNING id
      `;
      if (updated.length === 0) throw new Error("Source not found");
      await transaction`
        INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
        VALUES (${actor.workspaceId}, ${actor.id}, 'source_deleted', ${sourceId}, '{}'::jsonb)
      `;
    });
  }

  private async createSource(actor: Actor, input: {
    title: string; markdown: string; tags: string[]; sourceType: SourceType;
    originalFilename?: string; mimeType?: string; storagePath?: string; contentHash?: string;
  }): Promise<{ id: string; revisionNumber: number; chunkCount: number }> {
    const content = await this.prepareContent(input.markdown, input.contentHash);
    const revision = this.prepareRevision(content, {
      title: input.title,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      storagePath: input.storagePath,
    });
    const authority: Authority = actor.autoApprove ? "approved" : "unverified";
    return this.sql.begin(async (transaction) => {
      const sourceId = randomUUID();
      const revisionId = randomUUID();
      const [source] = await transaction<{ id: string }[]>`
        INSERT INTO sources (id, workspace_id, source_type, authority, current_revision_id, current_content_hash, created_by, last_verified_at)
        VALUES (${sourceId}, ${actor.workspaceId}, ${input.sourceType}, ${authority}, ${revisionId}, ${revision.contentHash}, ${actor.id},
                CASE WHEN ${actor.autoApprove}::boolean THEN now() END)
        RETURNING id
      `;
      if (!source) throw new Error("Unable to create source");
      await this.insertRevision(transaction, source.id, revisionId, 1, null, actor, revision);
      await this.replaceTags(transaction, source.id, input.tags);
      await transaction`
        INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
        VALUES (${actor.workspaceId}, ${actor.id}, 'source_submitted', ${source.id},
          ${transaction.json({ sourceType: input.sourceType, authority, revisionId })})
      `;
      if (actor.autoApprove) {
        await transaction`
          INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
          VALUES (${actor.workspaceId}, ${actor.id}, 'source_authority_changed', ${source.id},
            ${transaction.json({ authority: "approved", auto: true })})
        `;
      }
      return { id: source.id, revisionNumber: 1, chunkCount: revision.chunks.length };
    });
  }

  private async prepareContent(markdownInput: string, contentHash?: string): Promise<PreparedContent> {
    const markdown = markdownInput.trim();
    if (!markdown) throw new Error("Knowledge source cannot be empty");
    const chunks = chunkMarkdown(markdown);
    if (chunks.length === 0) throw new Error("Knowledge source does not contain indexable text");
    const vectors = await this.embeddings.embed(chunks.map((chunk) => chunk.content));
    return { markdown, contentHash: contentHash ?? digest(markdown), chunks, vectors };
  }

  private prepareRevision(content: PreparedContent, input: Omit<RevisionInput, "markdown" | "contentHash">): PreparedRevision {
    return { ...content, ...input };
  }

  private async insertRevision(transaction: TransactionSql, sourceId: string, revisionId: string, revisionNumber: number, supersedesRevisionId: string | null, actor: Actor, revision: PreparedRevision): Promise<string> {
    const [created] = await transaction<{ id: string }[]>`
      INSERT INTO source_revisions (
        id, source_id, revision_number, title, content_hash, markdown_content, original_filename, mime_type,
        storage_path, supersedes_revision_id, created_by
      ) VALUES (
        ${revisionId}, ${sourceId}, ${revisionNumber}, ${revision.title}, ${revision.contentHash}, ${revision.markdown},
        ${revision.originalFilename ?? null}, ${revision.mimeType ?? null}, ${revision.storagePath ?? null},
        ${supersedesRevisionId}, ${actor.id}
      ) RETURNING id
    `;
    if (!created) throw new Error("Unable to create source revision");
    for (const [ordinal, chunk] of revision.chunks.entries()) {
      await transaction`
        INSERT INTO chunks (source_id, source_revision_id, ordinal, heading, content, token_count, embedding, embedding_model)
        VALUES (${sourceId}, ${created.id}, ${ordinal}, ${chunk.heading}, ${chunk.content}, ${chunk.tokenCount},
                ${toVector(revision.vectors[ordinal]!)}::vector, ${this.config.EMBEDDING_MODEL})
      `;
    }
    return created.id;
  }

  private async replaceTags(transaction: TransactionSql, sourceId: string, tags: string[]): Promise<void> {
    await transaction`DELETE FROM source_tags WHERE source_id = ${sourceId}`;
    for (const tag of uniqueTags(tags)) {
      await transaction`INSERT INTO source_tags (source_id, tag) VALUES (${sourceId}, ${tag})`;
    }
  }

  /* Metadata goes through `sql.json` rather than `${JSON.stringify(x)}::jsonb`.
     On a bare postgres.js client the latter encodes twice and stores a jsonb
     *string* instead of an object, which reads back as unusable. The admin app
     must use the opposite form because Drizzle replaces the serializer on the
     client it wraps; see admin/src/lib/db.ts. */
  private async event(actor: Actor, eventType: string, sourceId: string | null, metadata: JSONValue): Promise<void> {
    await this.sql`
      INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
      VALUES (${actor.workspaceId}, ${actor.id}, ${eventType}, ${sourceId}, ${this.sql.json(metadata)})
    `;
  }
}

export function formatSearchResult(row: Record<string, unknown>, explain: boolean): Record<string, unknown> {
  const result = {
    sourceId: row.source_id,
    revisionNumber: row.revision_number,
    title: row.title,
    sourceType: row.source_type,
    authority: row.authority,
    author: row.author,
    authorId: row.author_id,
    heading: row.heading,
    excerpt: row.content,
    updatedAt: row.content_updated_at,
  };
  if (!explain) return result;
  const semanticScore = Number(row.semantic_score);
  const keywordScore = Number(row.keyword_score);
  const authorityBoost = Number(row.authority_boost);
  const freshnessBoost = Number(row.freshness_boost);
  return {
    ...result,
    scores: { semanticScore, keywordScore, authorityBoost, freshnessBoost, finalScore: Number(row.final_score) },
    explanation: [
      semanticScore > 0 ? "semantic match" : null,
      keywordScore > 0 ? "exact keyword match" : null,
      authorityBoost > 0 ? `${String(row.authority)} source` : null,
      freshnessBoost > 0 ? "recently updated" : null,
    ].filter(Boolean).join("; "),
  };
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function toVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
