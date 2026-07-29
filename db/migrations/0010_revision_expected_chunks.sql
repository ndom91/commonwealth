-- Mirrors admin/drizzle/0011_revision_expected_chunks.sql. The MCP server writes
-- this column on every revision it creates, so it has to exist in both chains or
-- the integration suite builds a schema its own insert no longer matches.
ALTER TABLE source_revisions ADD COLUMN expected_chunks integer;

UPDATE source_revisions
SET expected_chunks = (
  SELECT count(*) FROM chunks WHERE chunks.source_revision_id = source_revisions.id
);
