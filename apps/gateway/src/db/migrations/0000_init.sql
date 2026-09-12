CREATE TYPE "public"."attempt_outcome" AS ENUM('in_progress', 'success', 'incomplete', 'blocked', 'error', 'cancelled', 'abandoned', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."budget_reset" AS ENUM('hourly', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."dashboard_role" AS ENUM('owner', 'admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."extension_artifact_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."fallback_reason" AS ENUM('general', 'context_window', 'content_policy');--> statement-breakpoint
CREATE TYPE "public"."operation_lifecycle_state" AS ENUM('in_progress', 'finished');--> statement-breakpoint
CREATE TYPE "public"."operation_outcome" AS ENUM('success', 'incomplete', 'blocked', 'error', 'cancelled', 'abandoned', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."routing_strategy" AS ENUM('simple-shuffle', 'least-busy', 'usage-based-tpm', 'usage-based-rpm', 'latency-based', 'throughput-based', 'price-based', 'health-aware');--> statement-breakpoint
CREATE TYPE "public"."unsupported_parameter_strategy" AS ENUM('drop', 'error', 'allow');--> statement-breakpoint
CREATE TYPE "public"."video_asset_variant" AS ENUM('video', 'thumbnail', 'spritesheet');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('queued', 'in_progress', 'completed', 'failed', 'deleted');--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"request_id" text,
	"status" integer NOT NULL,
	"ip" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid,
	"role" "dashboard_role" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"session_ttl_minutes" integer DEFAULT 720 NOT NULL,
	"session_idle_minutes" integer DEFAULT 60 NOT NULL,
	"login_max_attempts" integer DEFAULT 5 NOT NULL,
	"login_lockout_minutes" integer DEFAULT 15 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_settings_id_singleton" CHECK ("dashboard_settings"."id" = 1),
	CONSTRAINT "dashboard_settings_session_ttl_valid" CHECK ("dashboard_settings"."session_ttl_minutes" > 0),
	CONSTRAINT "dashboard_settings_session_idle_valid" CHECK ("dashboard_settings"."session_idle_minutes" > 0),
	CONSTRAINT "dashboard_settings_login_max_attempts_valid" CHECK ("dashboard_settings"."login_max_attempts" > 0),
	CONSTRAINT "dashboard_settings_login_lockout_valid" CHECK ("dashboard_settings"."login_lockout_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "dashboard_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "dashboard_role" DEFAULT 'viewer' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extension_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"code" jsonb NOT NULL,
	"status" "extension_artifact_status" DEFAULT 'active' NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_artifacts_key_format" CHECK ("extension_artifacts"."key" ~ '^[a-z0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "extension_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"definition_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"critical" boolean,
	"priority" integer DEFAULT 0 NOT NULL,
	"match" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_instances_definition_key_format" CHECK ("extension_instances"."definition_key" ~ '^[a-z0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "extension_registry" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_registry_id_singleton" CHECK ("extension_registry"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "fallback_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"primary_model" text NOT NULL,
	"fallback_models" text[] NOT NULL,
	"reason" "fallback_reason" DEFAULT 'general' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fallback_policies_models_max5" CHECK (cardinality("fallback_policies"."fallback_models") BETWEEN 1 AND 5),
	CONSTRAINT "fallback_policies_primary_not_in_models" CHECK (NOT ("fallback_policies"."primary_model" = ANY("fallback_policies"."fallback_models")))
);
--> statement-breakpoint
CREATE TABLE "gateway_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"virtual_key_id" uuid,
	"actor" text,
	"public_model" text,
	"call_type" text NOT NULL,
	"lifecycle_state" "operation_lifecycle_state" DEFAULT 'in_progress' NOT NULL,
	"outcome" "operation_outcome",
	"degraded" boolean DEFAULT false NOT NULL,
	"terminal_verified" boolean DEFAULT false NOT NULL,
	"stream" boolean DEFAULT false NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"http_status" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"reasoning_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"total_tokens" integer,
	"search_units" integer,
	"consumer_cost_cents" numeric(20, 10),
	"upstream_cost_cents" numeric(20, 10),
	"duration_ms" integer,
	"first_event_ms" integer,
	"first_reasoning_ms" integer,
	"first_output_ms" integer,
	"max_inter_event_gap_ms" integer,
	"downstream_blocked_ms" integer,
	"upstream_bytes" integer,
	"downstream_bytes" integer,
	"last_progress_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"request_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reasoning" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	CONSTRAINT "gateway_operations_verified_terminal" CHECK ("gateway_operations"."outcome" IS NULL OR "gateway_operations"."outcome" NOT IN ('success', 'incomplete', 'blocked') OR "gateway_operations"."terminal_verified")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_model" text NOT NULL,
	"adapter_key" text NOT NULL,
	"upstream_model" text NOT NULL,
	"label" text,
	"failure_domain" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials" jsonb NOT NULL,
	"catalog_entry" jsonb,
	"pricing" jsonb,
	"execution_policy_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transport_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"tpm_limit" integer,
	"rpm_limit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_deployments_adapter_key_format" CHECK ("model_deployments"."adapter_key" ~ '^[a-z0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "payload_access_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"actor" text NOT NULL,
	"found" boolean NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payload_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"capture_reason" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accessed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "response_states" (
	"id" text PRIMARY KEY NOT NULL,
	"virtual_key_id" uuid,
	"public_model" text NOT NULL,
	"deployment_id" uuid,
	"adapter_key" text,
	"previous_response_id" text,
	"store" boolean DEFAULT true NOT NULL,
	"request_input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"response" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "response_states_adapter_key_format" CHECK ("response_states"."adapter_key" IS NULL OR "response_states"."adapter_key" ~ '^[a-z0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "router_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"routing_strategy" "routing_strategy" DEFAULT 'simple-shuffle' NOT NULL,
	"allowed_fails" integer DEFAULT 3 NOT NULL,
	"allowed_fails_by_class" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_rate_percent" real DEFAULT 0.5 NOT NULL,
	"min_window_requests" integer DEFAULT 5 NOT NULL,
	"protect_last_deployment" boolean DEFAULT true NOT NULL,
	"adaptive_timeouts_enabled" boolean DEFAULT true NOT NULL,
	"adaptive_timeout_multiplier" real DEFAULT 4 NOT NULL,
	"adaptive_timeout_floor_ms" integer DEFAULT 5000 NOT NULL,
	"cooldown_seconds" integer DEFAULT 5 NOT NULL,
	"failure_window_seconds" integer DEFAULT 60 NOT NULL,
	"max_cooldown_seconds" integer DEFAULT 300 NOT NULL,
	"half_open_probe_seconds" integer DEFAULT 30 NOT NULL,
	"configuration_cooldown_seconds" integer DEFAULT 300 NOT NULL,
	"throttle_cooldown_seconds" integer DEFAULT 5 NOT NULL,
	"execution_policies" jsonb DEFAULT '{"chat":{"json":{"firstOutputMs":300000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":300000,"totalMs":600000,"maxAttempts":6},"stream":{"firstOutputMs":180000,"idleMs":180000,"reasoningOnlyMs":null,"preCommitMs":300000,"totalMs":600000,"maxAttempts":6}},"images.generations":{"json":{"firstOutputMs":60000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":600000,"maxAttempts":3},"stream":{"firstOutputMs":60000,"idleMs":60000,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":600000,"maxAttempts":3}},"images.edits":{"json":{"firstOutputMs":60000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":600000,"maxAttempts":3},"stream":{"firstOutputMs":60000,"idleMs":60000,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":600000,"maxAttempts":3}},"audio.transcriptions":{"json":{"firstOutputMs":60000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":900000,"maxAttempts":2},"stream":{"firstOutputMs":60000,"idleMs":60000,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":900000,"maxAttempts":2}},"embeddings":{"json":{"firstOutputMs":30000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":60000,"totalMs":60000,"maxAttempts":3},"stream":{"firstOutputMs":30000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":60000,"totalMs":60000,"maxAttempts":3}},"rerank":{"json":{"firstOutputMs":30000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":60000,"totalMs":60000,"maxAttempts":3},"stream":{"firstOutputMs":30000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":60000,"totalMs":60000,"maxAttempts":3}},"videos.generations":{"json":{"firstOutputMs":60000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":120000,"totalMs":120000,"maxAttempts":3},"stream":{"firstOutputMs":30000,"idleMs":30000,"reasoningOnlyMs":null,"preCommitMs":60000,"totalMs":900000,"maxAttempts":2}}}'::jsonb NOT NULL,
	"retry_after_seconds" integer DEFAULT 0 NOT NULL,
	"unsupported_parameter_strategy" "unsupported_parameter_strategy" DEFAULT 'drop' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "router_settings_id_singleton" CHECK ("router_settings"."id" = 1),
	CONSTRAINT "router_settings_allowed_fails_valid" CHECK ("router_settings"."allowed_fails" >= 0),
	CONSTRAINT "router_settings_cooldown_seconds_valid" CHECK ("router_settings"."cooldown_seconds" >= 0),
	CONSTRAINT "router_settings_failure_window_seconds_valid" CHECK ("router_settings"."failure_window_seconds" > 0),
	CONSTRAINT "router_settings_max_cooldown_seconds_valid" CHECK ("router_settings"."max_cooldown_seconds" > 0),
	CONSTRAINT "router_settings_half_open_probe_seconds_valid" CHECK ("router_settings"."half_open_probe_seconds" > 0),
	CONSTRAINT "router_settings_configuration_cooldown_seconds_valid" CHECK ("router_settings"."configuration_cooldown_seconds" > 0),
	CONSTRAINT "router_settings_throttle_cooldown_seconds_valid" CHECK ("router_settings"."throttle_cooldown_seconds" > 0),
	CONSTRAINT "router_settings_retry_after_seconds_valid" CHECK ("router_settings"."retry_after_seconds" >= 0),
	CONSTRAINT "router_settings_failure_rate_percent_valid" CHECK ("router_settings"."failure_rate_percent" > 0 and "router_settings"."failure_rate_percent" <= 1),
	CONSTRAINT "router_settings_min_window_requests_valid" CHECK ("router_settings"."min_window_requests" >= 1),
	CONSTRAINT "router_settings_adaptive_timeout_multiplier_valid" CHECK ("router_settings"."adaptive_timeout_multiplier" >= 1),
	CONSTRAINT "router_settings_adaptive_timeout_floor_ms_valid" CHECK ("router_settings"."adaptive_timeout_floor_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "upstream_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"deployment_id" uuid,
	"deployment_label" text,
	"adapter_key" text,
	"transport" text,
	"upstream_model" text,
	"outcome" "attempt_outcome" NOT NULL,
	"terminal_verified" boolean DEFAULT false NOT NULL,
	"transport_terminator" text,
	"failure_owner" text,
	"failure_kind" text,
	"failure_phase" text,
	"health_effect" text DEFAULT 'neutral' NOT NULL,
	"http_status" integer,
	"provider_status" integer,
	"duration_ms" integer,
	"headers_ms" integer,
	"first_event_ms" integer,
	"first_reasoning_ms" integer,
	"first_output_ms" integer,
	"max_inter_event_gap_ms" integer,
	"downstream_blocked_ms" integer,
	"upstream_bytes" integer,
	"downstream_bytes" integer,
	"frames" integer,
	"metadata_frames" integer,
	"reasoning_frames" integer,
	"content_frames" integer,
	"tool_frames" integer,
	"media_frames" integer,
	"usage_frames" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"reasoning_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"total_tokens" integer,
	"search_units" integer,
	"last_progress_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "video_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" text NOT NULL,
	"variant" "video_asset_variant" NOT NULL,
	"object_key" text NOT NULL,
	"storage_backend" text NOT NULL,
	"content_type" text NOT NULL,
	"content_length" integer,
	"etag" text,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "video_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"virtual_key_id" uuid,
	"public_model" text NOT NULL,
	"deployment_id" uuid,
	"adapter_key" text NOT NULL,
	"upstream_model" text NOT NULL,
	"upstream_job_id" text NOT NULL,
	"upstream_generation_id" text,
	"upstream_polling_url" text,
	"provider_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request" jsonb NOT NULL,
	"prompt" text NOT NULL,
	"seconds" text,
	"size" text,
	"quality" text,
	"status" "video_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" jsonb,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone,
	CONSTRAINT "video_jobs_adapter_key_format" CHECK ("video_jobs"."adapter_key" ~ '^[a-z0-9]+$'),
	CONSTRAINT "video_jobs_progress_range" CHECK ("video_jobs"."progress" >= 0 AND "video_jobs"."progress" <= 100)
);
--> statement-breakpoint
CREATE TABLE "virtual_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"allowed_models" text[] DEFAULT '{}' NOT NULL,
	"max_budget_cents" integer,
	"budget_reset" "budget_reset",
	"budget_reset_at" timestamp with time zone,
	"spend_cents" numeric(20, 10) DEFAULT '0' NOT NULL,
	"tpm" integer,
	"rpm" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard_sessions" ADD CONSTRAINT "dashboard_sessions_user_id_dashboard_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_video_id_video_jobs_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_at_idx" ON "admin_audit" USING btree ("at");--> statement-breakpoint
CREATE INDEX "admin_audit_actor_idx" ON "admin_audit" USING btree ("actor");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_sessions_token_hash_idx" ON "dashboard_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "dashboard_sessions_user_id_idx" ON "dashboard_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dashboard_sessions_expires_at_idx" ON "dashboard_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_users_username_idx" ON "dashboard_users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "extension_artifacts_key_version_idx" ON "extension_artifacts" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "extension_artifacts_key_status_idx" ON "extension_artifacts" USING btree ("key","status");--> statement-breakpoint
CREATE INDEX "extension_instances_definition_key_idx" ON "extension_instances" USING btree ("definition_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fallback_policies_primary_reason_idx" ON "fallback_policies" USING btree ("primary_model","reason");--> statement-breakpoint
CREATE INDEX "gateway_operations_request_id_idx" ON "gateway_operations" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "gateway_operations_started_at_idx" ON "gateway_operations" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "gateway_operations_model_idx" ON "gateway_operations" USING btree ("public_model");--> statement-breakpoint
CREATE INDEX "gateway_operations_outcome_idx" ON "gateway_operations" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "gateway_operations_active_idx" ON "gateway_operations" USING btree ("lifecycle_state","last_progress_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_actor_key_idx" ON "idempotency_keys" USING btree ("actor","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "model_deployments_public_model_idx" ON "model_deployments" USING btree ("public_model");--> statement-breakpoint
CREATE INDEX "model_deployments_adapter_key_idx" ON "model_deployments" USING btree ("adapter_key");--> statement-breakpoint
CREATE INDEX "payload_access_audit_operation_idx" ON "payload_access_audit" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payload_samples_operation_idx" ON "payload_samples" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "payload_samples_expires_at_idx" ON "payload_samples" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "response_states_virtual_key_idx" ON "response_states" USING btree ("virtual_key_id");--> statement-breakpoint
CREATE INDEX "response_states_public_model_idx" ON "response_states" USING btree ("public_model");--> statement-breakpoint
CREATE INDEX "response_states_previous_response_idx" ON "response_states" USING btree ("previous_response_id");--> statement-breakpoint
CREATE INDEX "response_states_expires_at_idx" ON "response_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "upstream_attempts_operation_idx" ON "upstream_attempts" USING btree ("operation_id","ordinal");--> statement-breakpoint
CREATE INDEX "upstream_attempts_deployment_idx" ON "upstream_attempts" USING btree ("deployment_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "video_assets_video_variant_idx" ON "video_assets" USING btree ("video_id","variant");--> statement-breakpoint
CREATE INDEX "video_assets_expires_at_idx" ON "video_assets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "video_assets_deleted_at_idx" ON "video_assets" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "video_jobs_virtual_key_created_idx" ON "video_jobs" USING btree ("virtual_key_id","created_at");--> statement-breakpoint
CREATE INDEX "video_jobs_public_model_idx" ON "video_jobs" USING btree ("public_model");--> statement-breakpoint
CREATE INDEX "video_jobs_deployment_idx" ON "video_jobs" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "video_jobs_status_poll_idx" ON "video_jobs" USING btree ("status","next_poll_at");--> statement-breakpoint
CREATE INDEX "video_jobs_expires_at_idx" ON "video_jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_keys_key_hash_idx" ON "virtual_keys" USING btree ("key_hash");--> statement-breakpoint
-- The two singletons. drizzle-kit emits DDL only, so these are carried by hand across a
-- regeneration: every column carries a default, the row is created empty, and the application only
-- ever UPDATEs it. Both are read on a path that throws when the row is missing.
INSERT INTO "router_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "dashboard_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
