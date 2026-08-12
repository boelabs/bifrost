ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'latency-based';--> statement-breakpoint
ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'throughput-based';--> statement-breakpoint
ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'price-based';--> statement-breakpoint
ALTER TYPE "public"."routing_strategy" ADD VALUE IF NOT EXISTS 'health-aware';--> statement-breakpoint
CREATE TYPE "public"."unsupported_parameter_strategy" AS ENUM('drop', 'error', 'allow');--> statement-breakpoint
ALTER TABLE "router_settings" ADD COLUMN "unsupported_parameter_strategy" "unsupported_parameter_strategy" DEFAULT 'drop' NOT NULL;
