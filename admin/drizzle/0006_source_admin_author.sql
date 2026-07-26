ALTER TABLE "sources" ALTER COLUMN "created_by" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "created_by_admin_id" text REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_author_present" CHECK ("created_by" IS NOT NULL OR "created_by_admin_id" IS NOT NULL);
