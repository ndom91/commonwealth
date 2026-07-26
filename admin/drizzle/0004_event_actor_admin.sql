-- Who did this, when the actor was a person rather than an agent.
--
-- `events.actor_id` references `users` — the knowledge table that holds agent
-- identities. A signed-in administrator is a better-auth `user` row instead, so
-- every event the admin surface writes has recorded a NULL actor since the
-- baseline. "Who disabled this holder" has not been answerable.
--
-- This mirrors the existing `managed_api_key.created_by_admin_id` precedent:
-- a nullable second actor column rather than a polymorphic one, so both foreign
-- keys stay enforced. Exactly one of the two is set on any event the product
-- writes; agent-written history keeps actor_id and leaves this NULL.
--
-- `text`, not `uuid`: better-auth issues its own string ids, so `user.id` is a
-- text column and a uuid reference cannot be implemented against it.
ALTER TABLE "events" ADD COLUMN "actor_admin_id" text REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- The activity log reads newest-first across the whole workspace, and the
-- source bench reads one source's history. Both are covered by ordering on
-- created_at; the source_id filter already has an index from the baseline.
CREATE INDEX IF NOT EXISTS "events_created_at_idx" ON "events" ("created_at" DESC);
