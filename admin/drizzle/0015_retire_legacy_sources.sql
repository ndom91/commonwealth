-- Keep the live admin schema aligned with the MCP integration schema.
ALTER TABLE events DROP COLUMN source_id;
DROP TABLE chunks;
DROP TABLE source_tags;
DROP TABLE sources CASCADE;
DROP TABLE source_revisions;
