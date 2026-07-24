CREATE TABLE source_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  title text NOT NULL,
  content_hash text NOT NULL,
  markdown_content text NOT NULL,
  original_filename text,
  mime_type text,
  storage_path text,
  supersedes_revision_id uuid REFERENCES source_revisions(id),
  created_by uuid NOT NULL REFERENCES users(id),
  content_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, revision_number),
  UNIQUE (id, source_id)
);

ALTER TABLE sources ADD COLUMN current_revision_id uuid;
ALTER TABLE chunks ADD COLUMN source_revision_id uuid;

INSERT INTO source_revisions (
  source_id, revision_number, title, content_hash, markdown_content, original_filename,
  mime_type, storage_path, created_by, content_updated_at, created_at
)
SELECT
  id, 1, title, content_hash, markdown_content, original_filename,
  mime_type, storage_path, created_by, content_updated_at, created_at
FROM sources;

UPDATE sources
SET current_revision_id = source_revisions.id
FROM source_revisions
WHERE source_revisions.source_id = sources.id
  AND source_revisions.revision_number = 1;

UPDATE chunks
SET source_revision_id = source_revisions.id
FROM source_revisions
WHERE source_revisions.source_id = chunks.source_id
  AND source_revisions.revision_number = 1;

ALTER TABLE sources
  ADD CONSTRAINT sources_current_revision_id_fkey
  FOREIGN KEY (current_revision_id, id) REFERENCES source_revisions(id, source_id);
ALTER TABLE sources ALTER COLUMN current_revision_id SET NOT NULL;
ALTER TABLE chunks
  ADD CONSTRAINT chunks_source_revision_id_fkey
  FOREIGN KEY (source_revision_id, source_id) REFERENCES source_revisions(id, source_id) ON DELETE CASCADE;
ALTER TABLE chunks ALTER COLUMN source_revision_id SET NOT NULL;
ALTER TABLE chunks DROP CONSTRAINT chunks_source_id_ordinal_key;
ALTER TABLE chunks ADD CONSTRAINT chunks_source_revision_id_ordinal_key UNIQUE (source_revision_id, ordinal);

CREATE INDEX source_revisions_source_id_created_at_idx
  ON source_revisions (source_id, revision_number DESC);
CREATE INDEX sources_current_revision_id_idx ON sources (current_revision_id);
