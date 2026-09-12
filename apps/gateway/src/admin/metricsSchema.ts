import { OPERATION_IDS } from "#operations/registry.ts";
import * as z from "zod/v4";

export const metricsQuery = z
	.object({
		start: z.iso.datetime({ offset: true }),
		end: z.iso.datetime({ offset: true }),
		bucket: z.enum(["hour", "day"]).default("hour"),
		publicModel: z.string().min(1).max(256).optional(),
		deploymentId: z.uuid().optional(),
		operation: z.enum(OPERATION_IDS).optional(),
	})
	.refine(
		({ start, end }) => {
			const duration = Date.parse(end) - Date.parse(start);
			return duration > 0 && duration <= 31 * 86_400_000;
		},
		{ message: "Choose an increasing time range of at most 31 days" },
	);

const tokens = {
	promptTokens: z.number().nullable(),
	completionTokens: z.number().nullable(),
	reasoningTokens: z.number().nullable(),
	cacheReadTokens: z.number().nullable(),
	cacheWriteTokens: z.number().nullable(),
	totalTokens: z.number(),
	searchUnits: z.number().nullable(),
	usageReported: z.number(),
};
export const requestMetrics = z
	.object({
		...tokens,
		requests: z.number(),
		finished: z.number(),
		success: z.number(),
		errors: z.number(),
		incomplete: z.number(),
		blocked: z.number(),
		cancelled: z.number(),
		abandoned: z.number(),
		unknown: z.number(),
		degraded: z.number(),
		cacheHits: z.number(),
		consumerCostCents: z.number(),
		upstreamCostCents: z.number(),
		p50DurationMs: z.number().nullable(),
		p95DurationMs: z.number().nullable(),
		p95FirstOutputMs: z.number().nullable(),
	})
	.meta({ id: "RequestMetrics" });

export const attemptMetrics = z
	.object({
		...tokens,
		attempts: z.number(),
		finished: z.number(),
		errors: z.number(),
		success: z.number(),
		p95DurationMs: z.number().nullable(),
	})
	.meta({ id: "AttemptMetrics" });

export const detailedMetrics = z
	.object({
		start: z.string(),
		end: z.string(),
		bucket: z.enum(["hour", "day"]),
		requests: requestMetrics,
		attempts: attemptMetrics,
		series: z.array(requestMetrics.extend({ key: z.string() })),
		attemptSeries: z.array(attemptMetrics.extend({ key: z.string() })),
		models: z.array(requestMetrics.extend({ key: z.string().nullable() })),
		deployments: z.array(
			attemptMetrics.extend({
				key: z.string().nullable(),
				label: z.string().nullable(),
				adapter: z.string().nullable(),
			}),
		),
		failures: z.array(
			z.object({
				deploymentId: z.string().nullable(),
				label: z.string().nullable(),
				kind: z.string().nullable(),
				phase: z.string().nullable(),
				status: z.number().nullable(),
				count: z.number(),
			}),
		),
	})
	.meta({ id: "DetailedMetrics" });
