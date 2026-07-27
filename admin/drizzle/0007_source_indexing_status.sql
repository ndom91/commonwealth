-- A source now exists before its chunks do. Uploading a large document embeds
-- for minutes, and holding that inside the request meant a closed tab discarded
-- all of it, so the row is written first and indexed afterwards.
--
-- 'indexing' is deliberately not 'active': every MCP read filters on 'active',
-- and the unique content-hash index is partial on it, so a source part-way
-- through indexing is invisible to agents and does not yet claim its hash.
-- 'failed' has been in this constraint since 0001 with nothing ever writing it;
-- a run that dies part-way is what finally produces one.
ALTER TABLE sources DROP CONSTRAINT sources_status_check;
ALTER TABLE sources ADD CONSTRAINT sources_status_check
  CHECK (status IN ('active', 'indexing', 'failed', 'deleted'));
