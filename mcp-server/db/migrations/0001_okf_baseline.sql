CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE index_configuration (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  embedding_model text NOT NULL,
  embedding_dimensions integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('reader', 'writer', 'reviewer', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  auto_approve boolean NOT NULL DEFAULT false
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

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  actor_id uuid REFERENCES users(id),
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_index_state (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  indexed_commit_sha text,
  indexing_commit_sha text,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'indexing', 'failed')),
  failure text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE concepts (
  project_id uuid NOT NULL REFERENCES projects(id),
  path text NOT NULL,
  commit_sha text NOT NULL,
  content_hash text NOT NULL,
  type text NOT NULL,
  title text,
  description text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  frontmatter jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'stable', 'deprecated')),
  authority text NOT NULL CHECK (authority IN ('canonical', 'approved', 'unverified')),
  generated_by text,
  generated_at timestamptz,
  expected_chunks integer NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, path, commit_sha)
);

CREATE TABLE concept_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  concept_path text NOT NULL,
  commit_sha text NOT NULL,
  ordinal integer NOT NULL,
  heading text,
  content text NOT NULL,
  token_count integer NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding vector(1024) NOT NULL,
  embedding_model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, concept_path, commit_sha, ordinal),
  FOREIGN KEY (project_id, concept_path, commit_sha)
    REFERENCES concepts(project_id, path, commit_sha) ON DELETE CASCADE
);

CREATE INDEX events_created_at_idx ON events (created_at DESC);
CREATE INDEX concepts_project_commit_path_idx ON concepts (project_id, commit_sha, path);
CREATE INDEX concept_chunks_search_vector_idx ON concept_chunks USING gin(search_vector);
CREATE INDEX concept_chunks_embedding_idx ON concept_chunks USING hnsw (embedding vector_cosine_ops);
