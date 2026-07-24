CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "index_configuration" (
  "workspace_id" uuid PRIMARY KEY REFERENCES "workspaces"("id"),
  "embedding_model" text NOT NULL,
  "embedding_dimensions" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "display_name" text NOT NULL,
  "role" text NOT NULL CHECK (role IN ('reader', 'writer', 'reviewer', 'admin')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "disabled_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "key_prefix" text NOT NULL,
  "secret_hash" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_used_at" timestamptz,
  "revoked_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "source_type" text NOT NULL CHECK (source_type IN ('note', 'upload')),
  "status" text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'failed', 'deleted')),
  "authority" text NOT NULL DEFAULT 'unverified' CHECK (authority IN ('canonical', 'approved', 'unverified')),
  "current_content_hash" text NOT NULL,
  "current_revision_id" uuid NOT NULL,
  "last_verified_at" timestamptz,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "source_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_id" uuid NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
  "revision_number" integer NOT NULL,
  "title" text NOT NULL,
  "content_hash" text NOT NULL,
  "markdown_content" text NOT NULL,
  "original_filename" text,
  "mime_type" text,
  "storage_path" text,
  "supersedes_revision_id" uuid REFERENCES "source_revisions"("id"),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "content_updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("source_id", "revision_number"),
  UNIQUE ("id", "source_id")
);
--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_current_revision_id_fkey"
  FOREIGN KEY ("current_revision_id", "id") REFERENCES "source_revisions"("id", "source_id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TABLE "source_tags" (
  "source_id" uuid NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
  "tag" text NOT NULL,
  PRIMARY KEY ("source_id", "tag")
);
--> statement-breakpoint
CREATE TABLE "chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_id" uuid NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
  "source_revision_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "heading" text,
  "content" text NOT NULL,
  "token_count" integer NOT NULL,
  "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
  "embedding" vector(1024) NOT NULL,
  "embedding_model" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chunks_source_revision_id_fkey" FOREIGN KEY ("source_revision_id", "source_id") REFERENCES "source_revisions"("id", "source_id") ON DELETE CASCADE,
  UNIQUE ("source_revision_id", "ordinal")
);
--> statement-breakpoint
CREATE TABLE "events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "actor_id" uuid REFERENCES "users"("id"),
  "event_type" text NOT NULL,
  "source_id" uuid REFERENCES "sources"("id"),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "active_source_current_content_hash" ON "sources" ("workspace_id", "current_content_hash") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "chunks_search_vector_idx" ON "chunks" USING gin("search_vector");
--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "source_revisions_source_id_created_at_idx" ON "source_revisions" ("source_id", "revision_number" DESC);
--> statement-breakpoint
CREATE INDEX "sources_current_revision_id_idx" ON "sources" ("current_revision_id");
