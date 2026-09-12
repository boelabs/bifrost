import { z } from "zod";

export const PAGE_SIZE = 50;

/** The value a "no filter" option carries, since an empty string cannot be a `Select` value. */
export const ALL = "all";

export const OUTCOMES = [
	"success",
	"incomplete",
	"blocked",
	"error",
	"cancelled",
	"abandoned",
] as const;

/**
 * Windows an operator actually reasons in. "Everything" stays available because a quiet gateway may
 * have nothing at all in the last day, and an empty table with no way to widen the range reads as a
 * broken page rather than as a quiet one.
 */
export const PERIODS = {
	"1h": { label: "Last hour", ms: 3_600_000 },
	"24h": { label: "Last 24 hours", ms: 24 * 3_600_000 },
	"7d": { label: "Last 7 days", ms: 7 * 24 * 3_600_000 },
	"30d": { label: "Last 30 days", ms: 30 * 24 * 3_600_000 },
	all: { label: "Everything", ms: null },
} as const;

export type Period = keyof typeof PERIODS;

export const DEFAULT_PERIOD: Period = "24h";

const schema = z.object({
	outcome: z.enum(OUTCOMES).optional().catch(undefined),
	publicModel: z.string().min(1).optional().catch(undefined),
	actor: z.string().min(1).optional().catch(undefined),
	period: z.enum(["1h", "24h", "7d", "30d", "all"]).optional().catch(undefined),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
});

export type LogsFilters = z.infer<typeof schema>;

/** A hand-edited query string is normal input: every field falls back rather than throwing. */
export function parseLogsFilters(
	params: Record<string, string | string[] | undefined>,
): LogsFilters {
	return schema.parse(params);
}

export function isFiltered(filters: LogsFilters): boolean {
	return Boolean(filters.outcome || filters.publicModel || filters.actor);
}

/**
 * The table's column headers, kept here rather than beside the columns themselves: the page is a
 * Server Component and its `<Suspense>` fallback needs them, and a Server Component cannot read a
 * runtime value out of a `"use client"` module. Both sides import this one list, so the skeleton
 * and the real table cannot drift apart.
 */
export const LOG_HEADERS = [
	"Time",
	"Outcome",
	"Public model",
	"Call",
	"Actor",
	"Tokens",
	"Duration",
	"",
	"",
] as const;
