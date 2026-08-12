CREATE TYPE "public"."extension_artifact_status" AS ENUM('active', 'archived');--> statement-breakpoint
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
CREATE UNIQUE INDEX "extension_artifacts_key_version_idx" ON "extension_artifacts" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "extension_artifacts_key_status_idx" ON "extension_artifacts" USING btree ("key","status");--> statement-breakpoint
CREATE INDEX "extension_instances_definition_key_idx" ON "extension_instances" USING btree ("definition_key");