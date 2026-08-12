ALTER TABLE "router_settings" DROP CONSTRAINT "router_settings_max_attempts_per_pool_valid";--> statement-breakpoint
ALTER TABLE "router_settings" DROP CONSTRAINT "router_settings_max_attempts_per_request_valid";--> statement-breakpoint
ALTER TABLE "router_settings" DROP COLUMN "max_attempts_per_pool";--> statement-breakpoint
UPDATE "router_settings" SET "max_attempts_per_request" = GREATEST("max_attempts_per_request", "num_retries" + 1);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_max_attempts_per_request_valid" CHECK ("router_settings"."max_attempts_per_request" >= "router_settings"."num_retries" + 1);
