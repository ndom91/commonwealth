-- How many chunks a revision is supposed to have, recorded when the revision is
-- written rather than recomputed on demand.
--
-- Two readers decided whether indexing had finished by calling
-- `chunkMarkdown(markdown).length` and comparing it to the rows in `chunks` —
-- the restore guard in `restoreSource` and `total` in `getIndexingProgress`.
-- That proxy holds only while the chunker is byte-stable. The block-boundary
-- rewrite broke it for every existing row at once: restoring a perfectly
-- healthy source marked it `failed`, because the new chunker expected a
-- different number than the old one had stored. It works again only because a
-- reindex followed immediately.
--
-- An expectation belongs next to the thing it describes. Recorded here, the
-- comparison is between two facts about the same revision, and a chunker change
-- can no longer invalidate it.
ALTER TABLE source_revisions ADD COLUMN expected_chunks integer;

-- Backfill from what is actually indexed. For a revision behind an `active`
-- source this is correct by definition — `active` means every chunk of the
-- current revision is present. For `indexing` or `failed` it is provisional,
-- and is rewritten by the retry or reindex those states already require.
UPDATE source_revisions
SET expected_chunks = (
  SELECT count(*) FROM chunks WHERE chunks.source_revision_id = source_revisions.id
);
