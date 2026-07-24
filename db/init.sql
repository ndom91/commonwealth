CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE index_configuration (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
  embedding_model text NOT NULL,
  embedding_dimensions integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('reader', 'writer', 'reviewer', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  key_prefix text NOT NULL,
  secret_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  title text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('note', 'upload')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'failed', 'deleted')),
  authority text NOT NULL DEFAULT 'unverified' CHECK (authority IN ('canonical', 'approved', 'unverified')),
  original_filename text,
  mime_type text,
  storage_path text,
  content_hash text NOT NULL,
  markdown_content text NOT NULL,
  content_updated_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX active_source_content_hash
  ON sources(workspace_id, content_hash)
  WHERE status = 'active';

CREATE TABLE source_tags (
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (source_id, tag)
);

CREATE TABLE chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  heading text,
  content text NOT NULL,
  token_count integer NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding vector(1024) NOT NULL,
  embedding_model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, ordinal)
);

CREATE INDEX chunks_search_vector_idx ON chunks USING gin(search_vector);
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  actor_id uuid REFERENCES users(id),
  event_type text NOT NULL,
  source_id uuid REFERENCES sources(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
