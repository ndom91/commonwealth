-- The Git bundle is authoritative; these tables are its derived, commit-pinned
-- retrieval index. They intentionally coexist with the legacy source tables
-- during the code cutover, so the old API remains operational until every read
-- and write has moved to paths and commits.
CREATE TABLE workspace_index_state (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
  indexed_commit_sha text,
  indexing_commit_sha text,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'indexing', 'failed')),
  failure text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE concepts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  path text NOT NULL,
  commit_sha text NOT NULL,
  content_hash text NOT NULL,
  type text NOT NULL,
  title text,
  description text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  frontmatter jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('stable', 'deprecated')),
  authority text NOT NULL CHECK (authority IN ('canonical', 'approved', 'unverified')),
  generated_by text,
  generated_at timestamptz,
  expected_chunks integer NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, path, commit_sha)
);

CREATE TABLE concept_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
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
  UNIQUE (workspace_id, concept_path, commit_sha, ordinal),
  FOREIGN KEY (workspace_id, concept_path, commit_sha)
    REFERENCES concepts(workspace_id, path, commit_sha) ON DELETE CASCADE
);

CREATE INDEX concepts_workspace_commit_path_idx
  ON concepts (workspace_id, commit_sha, path);
CREATE INDEX concept_chunks_search_vector_idx ON concept_chunks USING gin(search_vector);
CREATE INDEX concept_chunks_embedding_idx ON concept_chunks USING hnsw (embedding vector_cosine_ops);
