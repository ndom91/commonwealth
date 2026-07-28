-- Mirrors admin/drizzle/0010_search_vector_covers_heading.sql. `search_vector`
-- is what the MCP server's hybrid search matches on, so the expression has to
-- ship in both chains or the integration suite builds an index that behaves
-- differently from the live one.
--
-- Dropped and re-added because Postgres 17 cannot alter a generated column's
-- expression in place; re-adding recomputes every row, so no reindex is needed.
ALTER TABLE chunks DROP COLUMN search_vector;

ALTER TABLE chunks ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(heading, '') || ' ' || content)) STORED;

CREATE INDEX chunks_search_vector_idx ON chunks USING gin(search_vector);
