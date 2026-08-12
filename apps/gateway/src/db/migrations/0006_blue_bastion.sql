ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_allowed_fails_valid" CHECK ("router_settings"."allowed_fails" >= 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_cooldown_seconds_valid" CHECK ("router_settings"."cooldown_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_failure_window_seconds_valid" CHECK ("router_settings"."failure_window_seconds" > 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_max_cooldown_seconds_valid" CHECK ("router_settings"."max_cooldown_seconds" > 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_half_open_probe_seconds_valid" CHECK ("router_settings"."half_open_probe_seconds" > 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_configuration_cooldown_seconds_valid" CHECK ("router_settings"."configuration_cooldown_seconds" > 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_throttle_cooldown_seconds_valid" CHECK ("router_settings"."throttle_cooldown_seconds" > 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_num_retries_valid" CHECK ("router_settings"."num_retries" >= 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_max_attempts_per_pool_valid" CHECK ("router_settings"."max_attempts_per_pool" > 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_max_attempts_per_request_valid" CHECK ("router_settings"."max_attempts_per_request" > 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_timeout_seconds_valid" CHECK ("router_settings"."timeout_seconds" > 0);--> statement-breakpoint
ALTER TABLE "router_settings" ADD CONSTRAINT "router_settings_retry_after_seconds_valid" CHECK ("router_settings"."retry_after_seconds" >= 0);