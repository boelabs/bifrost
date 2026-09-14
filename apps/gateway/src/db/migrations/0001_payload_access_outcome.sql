ALTER TABLE "payload_access_audit" ADD COLUMN "outcome" text;--> statement-breakpoint
UPDATE "payload_access_audit" SET "outcome" = CASE WHEN "found" THEN 'revealed' ELSE 'missing' END WHERE "outcome" IS NULL;--> statement-breakpoint
ALTER TABLE "payload_access_audit" ALTER COLUMN "outcome" SET NOT NULL;
