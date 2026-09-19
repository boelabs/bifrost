import { resolveRange, DAY } from "#/shared/lib/range.ts";
import type { DetailedMetrics } from "./api";
import { z } from "zod/v4";

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
 * Metrics opens on "today", as the overview and the logs do: this is the page someone opens while
 * watching a deploy, and a week of history would bury the hour they came to look at. The arithmetic
 * itself lives in `shared/lib/range.ts`, so the two cannot drift.
 */
export function metricsWindow(search: MetricsSearch, now = new Date()) {
	const { start, end, bucket } = resolveRange(search, "today", now);
	// Unreachable: metrics never offers "Everything", the one period without bounds.
	if (start === undefined || end === undefined) {
		throw new Error("Choose a bounded range.");
	}
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
export function duration(ms: number | null): string {
	if (ms === null) {
		return "—";
	}
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
export const rate = (n: number, total: number) =>
	total ? `${((n / total) * 100).toFixed(1)}%` : "—";
export const reportedTokens = (
	row: { totalTokens: number; usageReported: number },
	short = false,
) =>
	row.usageReported ? (short ? compact : count).format(row.totalTokens) : "—";

/**
 * One point of a series, where `null` means "no measurement" and `0` means "measured zero".
 *
 * A duration nobody recorded is a gap in the line, not a zero-millisecond request. Token counts
 * are the same when the upstream reported no usage at all: charting them as zero would say the
 * requests were free. Everything else counts events, where an absent bucket really is none.
 */
function pointValue(
	field: string,
	row: Record<string, unknown> | undefined,
): number | null {
	const value = row?.[field];
	if (field.includes("Duration")) {
		return typeof value === "number" ? value : null;
	}
	const unreportedTokens =
		field.endsWith("Tokens") &&
		row &&
		(value == null || (field === "totalTokens" && !row.usageReported));
	if (unreportedTokens) {
		return null;
	}
	return typeof value === "number" ? value : 0;
}

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
		result.push({ timestamp, value: pointValue(field, row) });
	}
	return result;
}
