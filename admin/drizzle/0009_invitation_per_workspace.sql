-- One live invitation per address *per workspace*, not per instance.
--
-- 0008 indexed `lower(email)` alone, from a time when there was one workspace
-- and the distinction could not arise. With several, that index says a person
-- may hold at most one outstanding invitation across the whole instance — so
-- the AI team inviting someone would collide with the invitation the core team
-- had already sent them, and `invitePerson` worked around the collision by
-- revoking every live invitation for that address regardless of who issued it.
-- One workspace's admin action silently cancelling another's credential is the
-- exact thing this wave exists to stop, and the workaround could not be scoped
-- while the index it was avoiding stayed global.
--
-- Widening the index is the fix; the supersede in `invitePerson` narrows to the
-- workspace in the same change. Re-inviting within a workspace still means
-- "here is a fresh link" rather than an error about one they never used.
--
-- No backfill: widening a unique index cannot fail on data that satisfied the
-- narrower one.
DROP INDEX IF EXISTS "member_invitation_live_email";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_invitation_live_email"
	ON "member_invitation" ("workspace_id", lower("email"))
	WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
