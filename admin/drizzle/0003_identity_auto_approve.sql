-- Trusted holders. When set, this identity's submissions and revisions arrive
-- already vouched for instead of landing in the review queue as unverified.
-- Off by default: trust is delegated deliberately, never inherited.
ALTER TABLE "users" ADD COLUMN "auto_approve" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- `sources.last_verified_at` has existed since the baseline and has never been
-- written. It now records when a human last vouched for a source, which is what
-- makes staleness computable: a source is stale when its current revision is
-- newer than the last verification.
--
-- Without this backfill every already-approved source would read as stale on the
-- first run of the review queue, burying the genuine work. Sources that carry a
-- non-default authority were vouched for at some point, so their creation time is
-- the most honest lower bound available.
UPDATE "sources"
SET "last_verified_at" = "created_at"
WHERE "authority" <> 'unverified' AND "last_verified_at" IS NULL;
