ALTER TABLE "model_deployments" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "model_deployments" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;