import type { Summary, UsageRow } from "./api.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const usageFields = [
	"requests",
	"promptTokens",
	"completionTokens",
	"reasoningTokens",
	"totalTokens",
	"searchUnits",
	"consumerCostCents",
	"upstreamCostCents",
] as const satisfies readonly (keyof UsageRow)[];

const terminalOutcomes = [
	"success",
	"incomplete",
	"blocked",
	"error",
	"cancelled",
	"abandoned",
	"unknown",
] as const;

type Outcome = (typeof terminalOutcomes)[number];
type OutcomeCounts = Record<Outcome | "inProgress", number>;
type UsageTotals = Omit<UsageRow, "key">;

/** One point of the activity series: an hour or a day, depending on how wide the range is. */
export type UsagePoint = UsageRow & {
	timestamp: number;
	intervalStart: number;
	intervalEnd: number;
};

export type UsageBucket = "hour" | "day";

export interface OverviewMetrics extends UsageTotals {
	/** Summary queries run independently from usage and can see a different request count. */
	summaryRequests: number;
	/** Live operations across all start times, not limited to the selected window. */
	activeRequests: number;
	outcomes: OutcomeCounts;
	finishedRequests: number;
	/** Fractions of finished outcomes, excluding in-progress requests. */
	successRate: number | null;
	errorRate: number | null;
	p95FirstOutputMs: number | null;
	retried: number;
	degraded: number;
	stalls: number;
	protocolErrors: number;
	/** Fractions of summaryRequests, including in-progress requests. */
	retryRate: number | null;
	degradedRate: number | null;
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function nonNegativeNumber(value: unknown): number | null {
	if (typeof value !== "number" && typeof value !== "string") return null;
	if (typeof value === "string" && value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function emptyUsage(): UsageTotals {
	return {
		requests: 0,
		promptTokens: 0,
		completionTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
		searchUnits: 0,
		consumerCostCents: 0,
		upstreamCostCents: 0,
	};
}

function addUsage(total: UsageTotals, row: UsageRow) {
	for (const field of usageFields) {
		total[field] += nonNegativeNumber(row[field]) ?? 0;
	}
}

function rate(count: number, total: number): number | null {
	return total > 0 ? count / total : null;
}

/** Token detail counters are subsets; reasoning is already included in completion tokens. */
export function getOverviewMetrics(
	summary: Summary,
	byModel: readonly UsageRow[],
): OverviewMetrics {
	const usage = emptyUsage();
	for (const row of byModel) addUsage(usage, row);
	const source = record(summary);
	const totals = record(source.totals);
	const outcomes: OutcomeCounts = {
		success: 0,
		incomplete: 0,
		blocked: 0,
		error: 0,
		cancelled: 0,
		abandoned: 0,
		unknown: 0,
		inProgress: 0,
	};
	if (Array.isArray(source.outcomes)) {
		for (const value of source.outcomes) {
			const row = record(value);
			const requests = nonNegativeNumber(row.requests) ?? 0;
			if (row.outcome === null) outcomes.inProgress += requests;
			else if (terminalOutcomes.includes(row.outcome as Outcome)) {
				outcomes[row.outcome as Outcome] += requests;
			}
		}
	}
	const finishedRequests = terminalOutcomes.reduce(
		(total, outcome) => total + outcomes[outcome],
		0,
	);
	const summaryRequests = nonNegativeNumber(totals.requests) ?? 0;
	const retried = nonNegativeNumber(totals.retried) ?? 0;
	const degraded = nonNegativeNumber(totals.degraded) ?? 0;
	return {
		...usage,
		summaryRequests,
		activeRequests: nonNegativeNumber(source.active) ?? 0,
		outcomes,
		finishedRequests,
		successRate: rate(outcomes.success, finishedRequests),
		errorRate: rate(outcomes.error, finishedRequests),
		p95FirstOutputMs: nonNegativeNumber(totals.p95FirstOutputMs),
		retried,
		degraded,
		stalls: nonNegativeNumber(totals.stalls) ?? 0,
		protocolErrors: nonNegativeNumber(totals.protocolErrors) ?? 0,
		retryRate: rate(retried, summaryRequests),
		degradedRate: rate(degraded, summaryRequests),
	};
}

function timestamp(value: string | Date | number): number {
	if (typeof value === "string") {
		const text = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T");
		// Postgres writes a whole-hour offset as "+00"; ISO wants "+00:00". Only a value that
		// carries a time can carry an offset — the day buckets arrive as a bare "2026-09-16",
		// whose day would otherwise be read as one and turn the whole series into NaN.
		const normalized = text.includes("T")
			? text.replace(/([+-]\d{2})$/, "$1:00")
			: text;
		return Date.parse(normalized);
	}
	return new Date(value).getTime();
}

/**
 * Fills the empty intervals of the activity series, so a quiet hour reads as a gap rather than
 * disappearing and pulling the next bar next to one three hours older.
 *
 * Rows must use the same range filter and the same grouping: aggregate values cannot be prorated
 * across a partial bucket.
 */
export function buildUsageSeries(
	rows: readonly UsageRow[],
	start: string | Date | number,
	end: string | Date | number,
	bucket: UsageBucket = "hour",
): UsagePoint[] {
	const size = bucket === "day" ? DAY_MS : HOUR_MS;
	const startMs = timestamp(start);
	const endMs = timestamp(end);
	if (
		!Number.isFinite(startMs) ||
		!Number.isFinite(endMs) ||
		endMs <= startMs
	) {
		return [];
	}
	const buckets = new Map<number, UsagePoint>();
	for (
		let interval = Math.floor(startMs / size) * size;
		interval < endMs;
		interval += size
	) {
		buckets.set(interval, {
			key: new Date(interval).toISOString(),
			...emptyUsage(),
			timestamp: interval,
			intervalStart: Math.max(interval, startMs),
			intervalEnd: Math.min(interval + size, endMs),
		});
	}
	for (const row of rows) {
		if (typeof row.key !== "string") continue;
		const interval = Math.floor(timestamp(row.key) / size) * size;
		const point = buckets.get(interval);
		if (point) addUsage(point, row);
	}
	return [...buckets.values()];
}
