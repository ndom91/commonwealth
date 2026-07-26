ALTER TABLE "source_revisions" ALTER COLUMN "created_by" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "source_revisions" ADD COLUMN "created_by_admin_id" text REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "source_revisions" ADD CONSTRAINT "source_revisions_author_present" CHECK ("created_by" IS NOT NULL OR "created_by_admin_id" IS NOT NULL);
