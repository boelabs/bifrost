CREATE TYPE "public"."video_asset_variant" AS ENUM('video', 'thumbnail', 'spritesheet');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('queued', 'in_progress', 'completed', 'failed', 'deleted');--> statement-breakpoint
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
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_video_id_video_jobs_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_assets_video_variant_idx" ON "video_assets" USING btree ("video_id","variant");--> statement-breakpoint
CREATE INDEX "video_assets_expires_at_idx" ON "video_assets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "video_assets_deleted_at_idx" ON "video_assets" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "video_jobs_virtual_key_created_idx" ON "video_jobs" USING btree ("virtual_key_id","created_at");--> statement-breakpoint
CREATE INDEX "video_jobs_public_model_idx" ON "video_jobs" USING btree ("public_model");--> statement-breakpoint
CREATE INDEX "video_jobs_deployment_idx" ON "video_jobs" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "video_jobs_status_poll_idx" ON "video_jobs" USING btree ("status","next_poll_at");--> statement-breakpoint
CREATE INDEX "video_jobs_expires_at_idx" ON "video_jobs" USING btree ("expires_at");