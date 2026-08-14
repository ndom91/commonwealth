-- OKF v0.2 lifecycle has three values. The first index migration shipped before
-- draft concepts were indexed, so widen the check without rewriting its history.
ALTER TABLE concepts DROP CONSTRAINT concepts_status_check;
ALTER TABLE concepts ADD CONSTRAINT concepts_status_check
  CHECK (status IN ('draft', 'stable', 'deprecated'));
