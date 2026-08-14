-- Git bundles and the commit-pinned concept index now own corpus state.
ALTER TABLE events DROP COLUMN source_id;
DROP TABLE chunks;
DROP TABLE source_tags;
DROP TABLE sources CASCADE;
DROP TABLE source_revisions;
