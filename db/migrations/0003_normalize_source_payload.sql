ALTER TABLE sources ADD COLUMN current_content_hash text;

UPDATE sources
SET current_content_hash = source_revisions.content_hash
FROM source_revisions
WHERE source_revisions.id = sources.current_revision_id;

ALTER TABLE sources ALTER COLUMN current_content_hash SET NOT NULL;
DROP INDEX active_source_content_hash;
CREATE UNIQUE INDEX active_source_current_content_hash
  ON sources(workspace_id, current_content_hash)
  WHERE status = 'active';

ALTER TABLE sources
  DROP COLUMN title,
  DROP COLUMN original_filename,
  DROP COLUMN mime_type,
  DROP COLUMN storage_path,
  DROP COLUMN content_hash,
  DROP COLUMN markdown_content,
  DROP COLUMN content_updated_at;
