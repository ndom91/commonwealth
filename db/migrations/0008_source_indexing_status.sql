-- Mirrors admin/drizzle/0007_source_indexing_status.sql. `sources.status` is a
-- column the MCP server reads, so the constraint has to ship in both chains or
-- the integration suite builds a schema the admin can no longer write to.
ALTER TABLE sources DROP CONSTRAINT sources_status_check;
ALTER TABLE sources ADD CONSTRAINT sources_status_check
  CHECK (status IN ('active', 'indexing', 'failed', 'deleted'));
