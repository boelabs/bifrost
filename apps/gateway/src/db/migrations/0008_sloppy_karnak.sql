CREATE TYPE "public"."attempt_outcome" AS ENUM('in_progress', 'success', 'incomplete', 'blocked', 'error', 'cancelled', 'abandoned', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."operation_lifecycle_state" AS ENUM('in_progress', 'finished');--> statement-breakpoint
CREATE TYPE "public"."operation_outcome" AS ENUM('success', 'incomplete', 'blocked', 'error', 'cancelled', 'abandoned', 'unknown');--> statement-breakpoint
CREATE TABLE "gateway_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"virtual_key_id" uuid,
	"public_model" text,
	"call_type" text NOT NULL,
	"lifecycle_state" "operation_lifecycle_state" DEFAULT 'in_progress' NOT NULL,
	"outcome" "operation_outcome",
	"degraded" boolean DEFAULT false NOT NULL,
	"terminal_verified" boolean DEFAULT false NOT NULL,
	"legacy" boolean DEFAULT false NOT NULL,
	"stream" boolean DEFAULT false NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"http_status" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"reasoning_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"total_tokens" integer,
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
	"last_progress_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb
);
--> statement-breakpoint
ALTER TABLE "router_settings" ADD COLUMN "execution_policies" jsonb DEFAULT '{"chat":{"json":{"firstOutputMs":30000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":100000,"totalMs":100000,"maxAttempts":6},"stream":{"firstOutputMs":30000,"idleMs":30000,"reasoningOnlyMs":90000,"preCommitMs":100000,"totalMs":600000,"maxAttempts":6}},"images.generations":{"json":{"firstOutputMs":60000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":600000,"maxAttempts":3},"stream":{"firstOutputMs":60000,"idleMs":60000,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":600000,"maxAttempts":3}},"images.edits":{"json":{"firstOutputMs":60000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":600000,"maxAttempts":3},"stream":{"firstOutputMs":60000,"idleMs":60000,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":600000,"maxAttempts":3}},"audio.transcriptions":{"json":{"firstOutputMs":60000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":900000,"maxAttempts":2},"stream":{"firstOutputMs":60000,"idleMs":60000,"reasoningOnlyMs":null,"preCommitMs":180000,"totalMs":900000,"maxAttempts":2}},"embeddings":{"json":{"firstOutputMs":30000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":60000,"totalMs":60000,"maxAttempts":3},"stream":{"firstOutputMs":30000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":60000,"totalMs":60000,"maxAttempts":3}},"videos.generations":{"json":{"firstOutputMs":60000,"idleMs":null,"reasoningOnlyMs":null,"preCommitMs":120000,"totalMs":120000,"maxAttempts":3},"stream":{"firstOutputMs":30000,"idleMs":30000,"reasoningOnlyMs":null,"preCommitMs":60000,"totalMs":900000,"maxAttempts":2}}}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "gateway_operations_request_id_idx" ON "gateway_operations" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "gateway_operations_started_at_idx" ON "gateway_operations" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "gateway_operations_model_idx" ON "gateway_operations" USING btree ("public_model");--> statement-breakpoint
CREATE INDEX "gateway_operations_outcome_idx" ON "gateway_operations" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "gateway_operations_active_idx" ON "gateway_operations" USING btree ("lifecycle_state","last_progress_at");--> statement-breakpoint
CREATE INDEX "payload_access_audit_operation_idx" ON "payload_access_audit" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payload_samples_operation_idx" ON "payload_samples" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "payload_samples_expires_at_idx" ON "payload_samples" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "upstream_attempts_operation_idx" ON "upstream_attempts" USING btree ("operation_id","ordinal");--> statement-breakpoint
CREATE INDEX "upstream_attempts_deployment_idx" ON "upstream_attempts" USING btree ("deployment_id","started_at");