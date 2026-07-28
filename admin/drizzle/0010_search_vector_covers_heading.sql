-- The lexical half of a chunk's index was missing its heading. `search_vector`
-- was `to_tsvector('english', content)` and `heading` sits in its own column,
-- so a chunk under "## Rate limiting" whose body never repeats the phrase could
-- not be found by the keyword arm of the hybrid search. The semantic arm had
-- the same gap and is fixed separately, in what gets embedded.
--
-- Dropped and re-added rather than altered: Postgres 17 has no syntax for
-- changing a generated column's expression in place. Re-adding a STORED
-- generated column recomputes it for every existing row, so this needs no
-- reindex and no re-embedding — unlike the chunker change, which does.
--
-- Dropping the column takes its index with it, hence the recreate.
ALTER TABLE chunks DROP COLUMN search_vector;

ALTER TABLE chunks ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(heading, '') || ' ' || content)) STORED;

CREATE INDEX chunks_search_vector_idx ON chunks USING gin(search_vector);
