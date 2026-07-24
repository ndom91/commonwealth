ALTER TABLE sources DROP CONSTRAINT sources_current_revision_id_fkey;
ALTER TABLE sources
  ADD CONSTRAINT sources_current_revision_id_fkey
  FOREIGN KEY (current_revision_id, id)
  REFERENCES source_revisions(id, source_id)
  DEFERRABLE INITIALLY DEFERRED;
