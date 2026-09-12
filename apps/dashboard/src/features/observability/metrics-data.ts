import type { DetailedMetrics } from "./api";
import * as z from "zod/v4";

const DAY = 86_400_000;
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

export function metricsWindow(search: MetricsSearch, now = new Date()) {
	const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
	let start = today;
	let end = now.getTime();
	if (search.period === "yesterday") {
		start -= DAY;
		end = today;
	}
	if (search.period === "7d") start -= 6 * DAY;
	if (search.period === "30d") start -= 29 * DAY;
	if (search.period === "custom") {
		if (!search.from || !search.to)
			throw new Error("Choose both dates for the custom range.");
		if (search.from > search.to || search.to > now.toISOString().slice(0, 10))
			throw new Error("Choose dates in order, ending today or earlier.");
		start = Date.parse(`${search.from}T00:00:00Z`);
		end = Math.min(Date.parse(`${search.to}T00:00:00Z`) + DAY, now.getTime());
	}
	if (
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		end < start ||
		end - start > 31 * DAY
	)
		throw new Error(
			"Choose an increasing range of at most 31 days, ending today or earlier.",
		);
	// A refresh precisely at midnight still needs a nonempty range.
	end = Math.max(end, start + 1);
	return {
		start: new Date(start).toISOString(),
		end: new Date(end).toISOString(),
		bucket: end - start > 2 * DAY ? ("day" as const) : ("hour" as const),
	};
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
