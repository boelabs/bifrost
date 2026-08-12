-- Breaking pre-1.0 cryptographic baseline: v1 envelopes are intentionally unsupported. Remove every
-- encrypted row instead of retaining unreadable/unauthenticated legacy data. Operators recreate
-- deployments and extension artifacts after configuring ENCRYPTION_KEYRING.
UPDATE "video_jobs" SET "deleted_at" = now(), "expires_at" = now(), "next_poll_at" = NULL WHERE "deleted_at" IS NULL;--> statement-breakpoint
DELETE FROM "extension_instances";--> statement-breakpoint
DELETE FROM "extension_artifacts";--> statement-breakpoint
DELETE FROM "payload_samples";--> statement-breakpoint
DELETE FROM "model_deployments";--> statement-breakpoint
ALTER TABLE "request_logs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "request_logs" CASCADE;--> statement-breakpoint
ALTER TABLE "router_settings" DROP CONSTRAINT "router_settings_num_retries_valid";--> statement-breakpoint
ALTER TABLE "router_settings" DROP CONSTRAINT "router_settings_max_attempts_per_request_valid";--> statement-breakpoint
ALTER TABLE "router_settings" DROP CONSTRAINT "router_settings_timeout_seconds_valid";--> statement-breakpoint
ALTER TABLE "gateway_operations" DROP COLUMN "legacy";--> statement-breakpoint
ALTER TABLE "router_settings" DROP COLUMN "num_retries";--> statement-breakpoint
ALTER TABLE "router_settings" DROP COLUMN "max_attempts_per_request";--> statement-breakpoint
ALTER TABLE "router_settings" DROP COLUMN "timeout_seconds";
