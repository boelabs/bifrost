ALTER TABLE "model_deployments" ADD COLUMN "failure_domain" text;--> statement-breakpoint
ALTER TABLE "router_settings" ADD COLUMN "failure_window_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "router_settings" ADD COLUMN "max_cooldown_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "router_settings" ADD COLUMN "half_open_probe_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "router_settings" ADD COLUMN "configuration_cooldown_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "router_settings" ADD COLUMN "throttle_cooldown_seconds" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "router_settings" ADD COLUMN "max_attempts_per_pool" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "router_settings" ADD COLUMN "max_attempts_per_request" integer DEFAULT 6 NOT NULL;