import { resolveRange, DAY } from "#/shared/lib/range.ts";
import type { DetailedMetrics } from "./api";
import * as z from "zod/v4";

export const metricsSearch = z.object({
	period: z.enum(["today", "yesterday", "7d", "30d", "custom"]).catch("today"),
	from: z.iso.date().optional().catch(undefined),
	to: z.iso.date().optional().catch(undefined),
	publicModel: z.string().min(1).optional().catch(undefined),
	deploymentId: z.uuid().optional().catch(undefined),
	operation: z
		.enum([
			"text.generate",
			"image.generate",
			"image.edit",
			"video.generate",
			"audio.transcribe",
			"embedding.create",
			"rerank",
		])
		.optional()
		.catch(undefined),
});
export type MetricsSearch = z.infer<typeof metricsSearch>;

/**
 * The metrics window, in the vocabulary every other table now uses.
 *
 * Metrics opens on "today" rather than the seven days the logs and the overview default to: this is
 * the page someone opens while watching a deploy, and a week of history would bury the hour they
 * came to look at. The arithmetic itself lives in `shared/lib/range.ts`, so the two cannot drift.
 */
export function metricsWindow(search: MetricsSearch, now = new Date()) {
	const { start, end, bucket } = resolveRange(search, "today", now);
	// Unreachable: metrics never offers "Everything", the one period without bounds.
	if (start === undefined || end === undefined)
		throw new Error("Choose a bounded range.");
	return { start, end, bucket };
}

export const count = new Intl.NumberFormat("en-US");
export const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
export const money = (cents: number) =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 4,
	}).format(cents / 100);
export const duration = (ms: number | null) =>
	ms === null
		? "—"
		: ms < 1000
			? `${Math.round(ms)} ms`
			: `${(ms / 1000).toFixed(2)} s`;
export const rate = (n: number, total: number) =>
	total ? `${((n / total) * 100).toFixed(1)}%` : "—";
export const reportedTokens = (
	row: { totalTokens: number; usageReported: number },
	short = false,
) =>
	row.usageReported ? (short ? compact : count).format(row.totalTokens) : "—";

export function metricSeries(
	data: DetailedMetrics,
	source: "series" | "attemptSeries",
	field: string,
) {
	const interval = data.bucket === "day" ? DAY : 3_600_000;
	const start = Date.parse(data.start);
	const end = Date.parse(data.end);
	const values = new Map(data[source].map((row) => [Date.parse(row.key), row]));
	const result: { timestamp: number; value: number | null }[] = [];
	for (let timestamp = start; timestamp < end; timestamp += interval) {
		const row = values.get(timestamp) as Record<string, unknown> | undefined;
		const isToken = field.endsWith("Tokens");
		const value = row?.[field];
		result.push({
			timestamp,
			value: field.includes("Duration")
				? typeof value === "number"
					? value
					: null
				: isToken &&
						row &&
						(value === null || (field === "totalTokens" && !row.usageReported))
					? null
					: typeof value === "number"
						? value
						: 0,
		});
	}
	return result;
}
