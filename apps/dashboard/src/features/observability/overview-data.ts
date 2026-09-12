import type { Summary, UsageRow } from "./api.ts";

const HOUR_MS = 3_600_000;

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

export type HourlyUsage = UsageRow & {
	timestamp: number;
	intervalStart: number;
	intervalEnd: number;
};

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
		const normalized = value
			.trim()
			.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T")
			.replace(/([+-]\d{2})$/, "$1:00");
		return Date.parse(normalized);
	}
	return new Date(value).getTime();
}

/** Rows must use the same range filter: aggregate values cannot be prorated at partial hours. */
export function buildHourlyUsage(
	rows: readonly UsageRow[],
	start: string | Date | number,
	end: string | Date | number,
): HourlyUsage[] {
	const startMs = timestamp(start);
	const endMs = timestamp(end);
	if (
		!Number.isFinite(startMs) ||
		!Number.isFinite(endMs) ||
		endMs <= startMs
	) {
		return [];
	}
	const buckets = new Map<number, HourlyUsage>();
	for (
		let hour = Math.floor(startMs / HOUR_MS) * HOUR_MS;
		hour < endMs;
		hour += HOUR_MS
	) {
		buckets.set(hour, {
			key: new Date(hour).toISOString(),
			...emptyUsage(),
			timestamp: hour,
			intervalStart: Math.max(hour, startMs),
			intervalEnd: Math.min(hour + HOUR_MS, endMs),
		});
	}
	for (const row of rows) {
		if (typeof row.key !== "string") continue;
		const hour = Math.floor(timestamp(row.key) / HOUR_MS) * HOUR_MS;
		const bucket = buckets.get(hour);
		if (bucket) addUsage(bucket, row);
	}
	return [...buckets.values()];
}
