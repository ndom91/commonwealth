import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import type { Config } from "./config.js";
import { hashApiKey, keyPrefix, verifyApiKey } from "./auth.js";
import { chunkMarkdown } from "./chunking.js";
import { Embeddings } from "./embeddings.js";
import { EMBEDDING_DIMENSIONS } from "./embeddings.js";

export type Role = "reader" | "writer" | "reviewer" | "admin";
export type Actor = { id: string; workspaceId: string; name: string; role: Role };

type KeyRow = Actor & { secret_hash: string };

const permissions: Record<Role, readonly string[]> = {
  reader: ["read"],
  writer: ["read", "write"],
  reviewer: ["read", "write", "review"],
  admin: ["read", "write", "review", "admin"],
};

export function requirePermission(actor: Actor, permission: "read" | "write" | "review" | "admin"): void {
  if (!permissions[actor.role].includes(permission)) {
    throw new Error("Your API key does not have permission for this operation");
  }
}

export class Database {
  readonly sql: Sql;

  constructor(
    private readonly config: Config,
    private readonly embeddings: Embeddings,
  ) {
    this.sql = postgres(config.DATABASE_URL);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async bootstrap(): Promise<void> {
    const [workspace] = await this.sql<{ id: string }[]>`
      INSERT INTO workspaces (name) VALUES ('default')
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
    if (!workspace) throw new Error("Unable to create default workspace");

    const [indexConfiguration] = await this.sql<{ embedding_model: string; embedding_dimensions: number }[]>`
      SELECT embedding_model, embedding_dimensions FROM index_configuration WHERE workspace_id = ${workspace.id}
    `;
    if (!indexConfiguration) {
      await this.sql`
        INSERT INTO index_configuration (workspace_id, embedding_model, embedding_dimensions)
        VALUES (${workspace.id}, ${this.config.EMBEDDING_MODEL}, ${EMBEDDING_DIMENSIONS})
      `;
    } else if (
      indexConfiguration.embedding_model !== this.config.EMBEDDING_MODEL ||
      indexConfiguration.embedding_dimensions !== EMBEDDING_DIMENSIONS
    ) {
      throw new Error("Embedding model differs from the existing index. Run a full reindex before changing EMBEDDING_MODEL.");
    }

    const [existingKey] = await this.sql`SELECT id FROM api_keys LIMIT 1`;
    if (existingKey) return;

    const [admin] = await this.sql<{ id: string }[]>`
      INSERT INTO users (workspace_id, display_name, role)
      VALUES (${workspace.id}, ${this.config.BOOTSTRAP_ADMIN_NAME}, 'admin')
      RETURNING id
    `;
    if (!admin) throw new Error("Unable to create bootstrap administrator");

    await this.sql`
      INSERT INTO api_keys (user_id, key_prefix, secret_hash)
      VALUES (${admin.id}, ${keyPrefix(this.config.BOOTSTRAP_ADMIN_KEY)}, ${hashApiKey(this.config.BOOTSTRAP_ADMIN_KEY)})
    `;
  }

  async authenticate(key: string): Promise<Actor | null> {
    const keys = await this.sql<KeyRow[]>`
      SELECT users.id, users.workspace_id AS "workspaceId", users.display_name AS name,
             users.role, api_keys.secret_hash
      FROM api_keys
      JOIN users ON users.id = api_keys.user_id
      WHERE api_keys.key_prefix = ${keyPrefix(key)}
        AND api_keys.revoked_at IS NULL
        AND users.disabled_at IS NULL
    `;

    const match = keys.find((candidate) => verifyApiKey(key, candidate.secret_hash));
    if (!match) return null;

    await this.sql`UPDATE api_keys SET last_used_at = now() WHERE secret_hash = ${match.secret_hash}`;
    return { id: match.id, workspaceId: match.workspaceId, name: match.name, role: match.role };
  }

  async submitNote(actor: Actor, input: { title: string; markdown: string; tags: string[] }): Promise<{ id: string; chunkCount: number }> {
    requirePermission(actor, "write");
    return this.indexSource(actor, { ...input, authority: "unverified", sourceType: "note" });
  }

  async submitDocument(actor: Actor, input: { title: string; filename: string; mimeType: string; bytes: Uint8Array; tags: string[] }): Promise<{ id: string; chunkCount: number }> {
    requirePermission(actor, "write");
    if (input.bytes.byteLength > this.config.MAX_UPLOAD_BYTES) {
      throw new Error(`Document exceeds the ${this.config.MAX_UPLOAD_BYTES} byte upload limit`);
    }

    const allowedTypes = new Set([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "text/html",
      "text/markdown",
      "text/plain",
    ]);
    if (!allowedTypes.has(input.mimeType)) throw new Error("Unsupported document MIME type");

    const form = new FormData();
    form.append("file", new Blob([Buffer.from(input.bytes)], { type: input.mimeType }), input.filename);
    const response = await fetch(`${this.config.MARKITDOWN_URL}/convert`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Document conversion failed");
    const payload = (await response.json()) as { markdown?: string };
    if (!payload.markdown?.trim()) throw new Error("Document conversion produced no text");

    const contentHash = digest(input.bytes);
    const storagePath = join(this.config.SOURCE_STORAGE_PATH, contentHash);
    await mkdir(this.config.SOURCE_STORAGE_PATH, { recursive: true });
    try {
      await writeFile(storagePath, input.bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existingFile = await readFile(storagePath);
      if (digest(existingFile) !== contentHash) throw new Error("Stored document content does not match its expected hash");
    }

    try {
      return await this.indexSource(actor, {
        title: input.title,
        markdown: payload.markdown,
        tags: input.tags,
        authority: "unverified",
        sourceType: "upload",
        originalFilename: input.filename,
        mimeType: input.mimeType,
        storagePath,
        contentHash,
      });
    } catch (error) {
      // Content-addressed files can be shared by concurrent identical uploads.
      // A later maintenance job can remove unreferenced blobs without risking a live source.
      console.error("Document indexing failed; retaining content-addressed blob for safe cleanup", error);
      throw error;
    }
  }

  async search(actor: Actor, query: string, tags: string[], limit: number): Promise<unknown[]> {
    requirePermission(actor, "read");
    const [embedding] = await this.embeddings.embed([query]);
    if (!embedding) throw new Error("Embedding provider returned no query embedding");
    const vector = toVector(embedding);
    const requiredTags = tags.length === 0 ? null : tags;
    const results = await this.sql`
      WITH candidates AS (
        SELECT chunks.id, chunks.content, chunks.heading, sources.id AS source_id,
               sources.title, sources.authority, sources.content_updated_at,
               1 - (chunks.embedding <=> ${vector}::vector) AS semantic_score,
               ts_rank_cd(chunks.search_vector, websearch_to_tsquery('english', ${query})) AS keyword_score
        FROM chunks
        JOIN sources ON sources.id = chunks.source_id
        WHERE sources.workspace_id = ${actor.workspaceId}
          AND sources.status = 'active'
          AND (${requiredTags}::text[] IS NULL OR EXISTS (
            SELECT 1 FROM source_tags WHERE source_tags.source_id = sources.id AND source_tags.tag = ANY(${requiredTags}::text[])
          ))
        ORDER BY chunks.embedding <=> ${vector}::vector
        LIMIT ${Math.max(limit * 8, 20)}
      )
      SELECT *,
        (semantic_score * 0.78) + (LEAST(keyword_score, 1) * 0.14) +
        (CASE authority WHEN 'canonical' THEN 0.06 WHEN 'approved' THEN 0.03 ELSE 0 END) +
        (CASE WHEN content_updated_at > now() - interval '90 days' THEN 0.02 ELSE 0 END) AS final_score
      FROM candidates
      ORDER BY final_score DESC
      LIMIT ${limit}
    `;

    await this.event(actor, "search", null, { query, resultCount: results.length }).catch((error) => {
      console.error("Unable to record search event", error);
    });
    return results;
  }

  async getSource(actor: Actor, sourceId: string): Promise<unknown> {
    requirePermission(actor, "read");
    const [source] = await this.sql`
      SELECT sources.id, sources.title, sources.source_type, sources.authority, sources.markdown_content,
             sources.content_updated_at, sources.last_verified_at, users.display_name AS created_by
      FROM sources JOIN users ON users.id = sources.created_by
      WHERE sources.id = ${sourceId} AND sources.workspace_id = ${actor.workspaceId} AND sources.status = 'active'
    `;
    if (!source) throw new Error("Source not found");
    return source;
  }

  async setAuthority(actor: Actor, sourceId: string, authority: "canonical" | "approved" | "unverified"): Promise<void> {
    requirePermission(actor, "review");
    await this.sql.begin(async (transaction) => {
      const updated = await transaction`
        UPDATE sources SET authority = ${authority}
        WHERE id = ${sourceId} AND workspace_id = ${actor.workspaceId} AND status = 'active'
        RETURNING id
      `;
      if (updated.length === 0) throw new Error("Source not found");
      await transaction`
        INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
        VALUES (${actor.workspaceId}, ${actor.id}, 'source_authority_changed', ${sourceId}, ${JSON.stringify({ authority })}::jsonb)
      `;
    });
  }

  async deleteSource(actor: Actor, sourceId: string): Promise<void> {
    requirePermission(actor, "review");
    await this.sql.begin(async (transaction) => {
      const updated = await transaction`
        UPDATE sources SET status = 'deleted', deleted_at = now()
        WHERE id = ${sourceId} AND workspace_id = ${actor.workspaceId} AND status = 'active'
        RETURNING id
      `;
      if (updated.length === 0) throw new Error("Source not found");
      await transaction`
        INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
        VALUES (${actor.workspaceId}, ${actor.id}, 'source_deleted', ${sourceId}, '{}'::jsonb)
      `;
    });
  }

  private async indexSource(actor: Actor, input: {
    title: string;
    markdown: string;
    tags: string[];
    authority: "canonical" | "approved" | "unverified";
    sourceType: "note" | "upload";
    originalFilename?: string;
    mimeType?: string;
    storagePath?: string;
    contentHash?: string;
  }): Promise<{ id: string; chunkCount: number }> {
    const markdown = input.markdown.trim();
    if (!markdown) throw new Error("Knowledge source cannot be empty");
    const chunks = chunkMarkdown(markdown);
    if (chunks.length === 0) throw new Error("Knowledge source does not contain indexable text");
    const vectors = await this.embeddings.embed(chunks.map((chunk) => chunk.content));
    const contentHash = input.contentHash ?? digest(markdown);

    return this.sql.begin(async (transaction) => {
      const [source] = await transaction<{ id: string }[]>`
        INSERT INTO sources (
          workspace_id, title, source_type, authority, original_filename, mime_type, storage_path,
          content_hash, markdown_content, created_by
        ) VALUES (
          ${actor.workspaceId}, ${input.title}, ${input.sourceType}, ${input.authority},
          ${input.originalFilename ?? null}, ${input.mimeType ?? null}, ${input.storagePath ?? null},
          ${contentHash}, ${markdown}, ${actor.id}
        )
        RETURNING id
      `;
      if (!source) throw new Error("Unable to create source");

      for (const [ordinal, chunk] of chunks.entries()) {
        await transaction`
          INSERT INTO chunks (source_id, ordinal, heading, content, token_count, embedding, embedding_model)
          VALUES (${source.id}, ${ordinal}, ${chunk.heading}, ${chunk.content}, ${chunk.tokenCount},
                  ${toVector(vectors[ordinal]!)}::vector, ${this.config.EMBEDDING_MODEL})
        `;
      }
      for (const tag of [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))]) {
        await transaction`INSERT INTO source_tags (source_id, tag) VALUES (${source.id}, ${tag})`;
      }
      await transaction`
        INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
        VALUES (${actor.workspaceId}, ${actor.id}, 'source_submitted', ${source.id},
                ${transaction.json({ sourceType: input.sourceType, authority: input.authority })})
      `;
      return { id: source.id, chunkCount: chunks.length };
    });
  }

  private async event(actor: Actor, eventType: string, sourceId: string | null, metadata: Record<string, unknown>): Promise<void> {
    await this.sql`
      INSERT INTO events (workspace_id, actor_id, event_type, source_id, metadata)
      VALUES (${actor.workspaceId}, ${actor.id}, ${eventType}, ${sourceId}, ${JSON.stringify(metadata)}::jsonb)
    `;
  }
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function toVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
