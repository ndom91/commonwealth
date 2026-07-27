-- Membership replaces the binary `admin_role`.
--
-- Before this, everyone who could sign in was an administrator: `admin_role`
-- carried no role column, so a teammate who should only browse sources could
-- also issue API credentials. Membership gives each person a role in a
-- workspace, using the same four names the MCP server already grants to agents
-- (`src/access-service.ts`) so that a human writer and an agent writer mean the
-- same thing.
--
-- Only in this chain, never in db/migrations: these tables reference
-- better-auth's "user", which the integration suite's schema does not contain.

-- `workspaces` becomes better-auth's `organization` table, remapped by name in
-- `admin/src/lib/auth.ts` rather than duplicated. The plugin requires a slug;
-- the other two columns it expects are optional to it but must exist.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "slug" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "logo" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "metadata" text;--> statement-breakpoint
UPDATE "workspaces"
	SET "slug" = trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g')))
	WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_slug_unique" ON "workspaces" ("slug");--> statement-breakpoint

-- Who may act, and how much. One row per person per workspace.
--
-- The role check mirrors `users_role_check` on the agent side deliberately: two
-- vocabularies for the same four powers would be a permanent source of "wait,
-- does writer mean the same thing here?".
CREATE TABLE IF NOT EXISTS "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "member_role_check" CHECK ("role" IN ('reader', 'writer', 'reviewer', 'admin')),
	CONSTRAINT "member_workspace_user_unique" UNIQUE ("workspace_id", "user_id")
);--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Every existing administrator keeps exactly the powers they had. Done before
-- the drop so the old table is the source of truth for the backfill and there
-- is no window where nobody can administer the instance.
INSERT INTO "member" ("workspace_id", "user_id", "role")
	SELECT (SELECT "id" FROM "workspaces" WHERE "name" = 'default'), "user_id", 'admin'
	FROM "admin_role"
	ON CONFLICT ("workspace_id", "user_id") DO NOTHING;--> statement-breakpoint
DROP TABLE IF EXISTS "admin_role";--> statement-breakpoint

-- better-auth's own invitation table, for inviting someone who *already has an
-- account* into a workspace. Nothing uses it yet — wave A adds an existing
-- account to a workspace directly — but the plugin's endpoints are live routes,
-- and a missing table turns a permission refusal into a 500.
CREATE TABLE IF NOT EXISTS "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"inviter_id" text NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk"
	FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Our own invitation: a single-use, expiring authorisation to create one named
-- account at one role. Distinct from the table above because better-auth's
-- `acceptInvitation` requires the invitee to already hold an account, and the
-- whole point here is the person who does not.
--
-- It exists so that adding a teammate stops meaning "type a password, read it
-- off the screen, and send it over Slack" — the issuer never learns the
-- credential, because the recipient chooses it.
--
-- `timestamptz` rather than the naive `timestamp` better-auth uses for its own
-- tables. Whether an invitation has expired is a comparison against now(), and
-- a naive timestamp makes that answer depend on the session timezone.
CREATE TABLE IF NOT EXISTS "member_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL,
	"name" text NOT NULL,
	-- SHA-256 of the token, never the token. A fast digest is correct here and
	-- scrypt would not be: this is 256 bits of entropy, not a password, so
	-- there is nothing to brute-force and an indexed equality lookup is exactly
	-- what redemption needs.
	"token_hash" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"accepted_at" timestamptz,
	"revoked_at" timestamptz,
	CONSTRAINT "member_invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "member_invitation_role_check" CHECK ("role" IN ('reader', 'writer', 'reviewer', 'admin'))
);--> statement-breakpoint
ALTER TABLE "member_invitation" ADD CONSTRAINT "member_invitation_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invitation" ADD CONSTRAINT "member_invitation_invited_by_user_id_fk"
	FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One live invitation per address. Re-inviting someone replaces the outstanding
-- link rather than leaving two valid ones, so revoking is not a guessing game
-- about which of them is still out there.
CREATE UNIQUE INDEX IF NOT EXISTS "member_invitation_live_email"
	ON "member_invitation" (lower("email"))
	WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
