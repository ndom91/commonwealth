-- Mirrors db/migrations/0012_okf_draft_status.sql. OKF v0.2 permits draft,
-- stable, and deprecated concepts.
ALTER TABLE concepts DROP CONSTRAINT concepts_status_check;
ALTER TABLE concepts ADD CONSTRAINT concepts_status_check
  CHECK (status IN ('draft', 'stable', 'deprecated'));
