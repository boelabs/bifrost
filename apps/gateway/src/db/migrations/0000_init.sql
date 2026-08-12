CREATE TYPE "public"."budget_reset" AS ENUM('hourly', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."fallback_reason" AS ENUM('general', 'context_window', 'content_policy');--> statement-breakpoint
CREATE TYPE "public"."routing_strategy" AS ENUM('simple-shuffle', 'least-busy', 'usage-based-tpm', 'usage-based-rpm');--> statement-breakpoint
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
CREATE TABLE "model_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_model" text NOT NULL,
	"adapter_key" text NOT NULL,
	"upstream_model" text NOT NULL,
	"credentials" jsonb NOT NULL,
	"catalog_entry" jsonb,
	"pricing" jsonb,
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
CREATE TABLE "request_logs" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"virtual_key_id" uuid,
	"public_model" text,
	"deployment_id" uuid,
	"adapter_key" text,
	"call_type" text NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"cost_cents" numeric(20, 10),
	"duration_ms" integer,
	"ttft_ms" integer,
	"upstream_ttft_ms" integer,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text,
	"start_time" timestamp with time zone DEFAULT now() NOT NULL,
	"end_time" timestamp with time zone,
	"request_body" jsonb,
	"response_body" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"attempts" jsonb,
	CONSTRAINT "request_logs_id_start_time_pk" PRIMARY KEY("id","start_time"),
	CONSTRAINT "request_logs_adapter_key_format" CHECK ("request_logs"."adapter_key" IS NULL OR "request_logs"."adapter_key" ~ '^[a-z0-9]+$')
) PARTITION BY RANGE ("start_time");
--> statement-breakpoint
-- request_logs is range-partitioned by day (see src/db/requestLogPartitions.ts). drizzle-kit cannot
-- express PARTITION BY, so the partitioning and the default partition are added here by hand; the
-- drizzle snapshot still describes request_logs as a plain table, which is fine because drizzle-kit
-- never needs to touch the partitioning on a generate.
CREATE TABLE "request_logs_default" PARTITION OF "request_logs" DEFAULT;
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
	"cooldown_seconds" integer DEFAULT 5 NOT NULL,
	"num_retries" integer DEFAULT 3 NOT NULL,
	"timeout_seconds" integer DEFAULT 600 NOT NULL,
	"retry_after_seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "router_settings_id_singleton" CHECK ("router_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "virtual_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"name" text NOT NULL,
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
CREATE UNIQUE INDEX "fallback_policies_primary_reason_idx" ON "fallback_policies" USING btree ("primary_model","reason");--> statement-breakpoint
CREATE INDEX "model_deployments_public_model_idx" ON "model_deployments" USING btree ("public_model");--> statement-breakpoint
CREATE INDEX "model_deployments_adapter_key_idx" ON "model_deployments" USING btree ("adapter_key");--> statement-breakpoint
CREATE INDEX "request_logs_start_time_idx" ON "request_logs" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "request_logs_virtual_key_idx" ON "request_logs" USING btree ("virtual_key_id");--> statement-breakpoint
CREATE INDEX "request_logs_public_model_idx" ON "request_logs" USING btree ("public_model");--> statement-breakpoint
CREATE INDEX "request_logs_request_id_idx" ON "request_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "response_states_virtual_key_idx" ON "response_states" USING btree ("virtual_key_id");--> statement-breakpoint
CREATE INDEX "response_states_public_model_idx" ON "response_states" USING btree ("public_model");--> statement-breakpoint
CREATE INDEX "response_states_previous_response_idx" ON "response_states" USING btree ("previous_response_id");--> statement-breakpoint
CREATE INDEX "response_states_expires_at_idx" ON "response_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_keys_key_hash_idx" ON "virtual_keys" USING btree ("key_hash");--> statement-breakpoint
-- Seed the singleton router_settings row (id = 1). drizzle-kit does not generate data, so it is
-- inserted here by hand.
INSERT INTO "router_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;