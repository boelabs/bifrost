import * as z from "zod/v4";

/**
 * One time range vocabulary for every table in the dashboard.
 *
 * Ranges are anchored to UTC midnight rather than rolling back from "now", because the question an
 * operator asks is "what happened yesterday" or "this week", not "what happened in the last 86400
 * seconds" — and because a day-anchored window gives the same answer when two people open it four
 * minutes apart. Metrics, logs, the audit trail and the overview all read the same rows, so they say
 * "7 days" the same way and a range survives being pasted between pages.
 */
export const DAY = 86_400_000;

export const RANGES = {
	today: "Today",
	yesterday: "Yesterday",
	"7d": "Last 7 days",
	"30d": "Last 30 days",
	custom: "Custom dates",
	/** Unbounded. Only offered where a table can honestly show everything it has. */
	all: "Everything",
} as const;

export type RangeKey = keyof typeof RANGES;

/** The widest range any of these endpoints accepts: both read raw operation rows. */
export const MAX_RANGE_DAYS = 31;

/**
 * Declared as a type rather than an interface on purpose: the search writer takes a plain record of
 * query values, and only a type alias carries the implicit index signature that makes it one.
 */
// biome-ignore lint/style/useConsistentTypeDefinitions: see above — an interface has no implicit index signature.
export type RangeSearch = {
	period?: RangeKey | undefined;
	from?: string | undefined;
	to?: string | undefined;
};

export interface ResolvedRange {
	/** Absent only for "Everything", which asks the gateway for no bound at all. */
	start?: string;
	end?: string;
	/** Hourly up to two days, daily beyond it: a month of hourly points reads as noise. */
	bucket: "hour" | "day";
}

/**
 * The query-string fields every ranged page shares, with a per-page set of periods.
 *
 * A hand-edited URL is ordinary input: an unknown period reads as "unset" and the page falls back to
 * its own default, rather than throwing an error page at whoever pasted the link.
 */
export function rangeSchema<K extends RangeKey>(periods: readonly K[]) {
	return {
		period: z
			.string()
			.optional()
			.transform((value) =>
				value !== undefined && (periods as readonly string[]).includes(value)
					? (value as K)
					: undefined,
			),
		from: z.iso.date().optional().catch(undefined),
		to: z.iso.date().optional().catch(undefined),
	};
}

export function today(now: Date): number {
	return Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
}

/** Whether a pair of `yyyy-mm-dd` values is a range this dashboard will accept. */
export function customRangeIsValid(
	from: string | undefined,
	to: string | undefined,
	now = new Date(),
): boolean {
	if (!(from && to) || from > to) {
		return false;
	}
	const span = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
	return (
		Number.isFinite(span) &&
		span < MAX_RANGE_DAYS * DAY &&
		to <= now.toISOString().slice(0, 10)
	);
}

/**
 * Turns the URL into the bounds a gateway query takes.
 *
 * Throws on a custom range that cannot be honoured, so a page that wants to say so can catch it; use
 * `safeRange` where falling back to the default reads better than an error screen.
 */
export function resolveRange(
	search: RangeSearch,
	fallback: RangeKey,
	now = new Date(),
): ResolvedRange {
	const period = search.period ?? fallback;
	if (period === "all") {
		return { bucket: "day" };
	}
	const midnight = today(now);
	let start = midnight;
	let end = now.getTime();
	if (period === "yesterday") {
		start -= DAY;
		end = midnight;
	}
	if (period === "7d") {
		start -= 6 * DAY;
	}
	if (period === "30d") {
		start -= 29 * DAY;
	}
	if (period === "custom") {
		if (!(search.from && search.to)) {
			throw new Error("Choose both dates for the custom range.");
		}
		if (!customRangeIsValid(search.from, search.to, now)) {
			throw new Error(
				`Choose an increasing range of at most ${MAX_RANGE_DAYS} days, ending today or earlier.`,
			);
		}
		start = Date.parse(`${search.from}T00:00:00Z`);
		end = Math.min(Date.parse(`${search.to}T00:00:00Z`) + DAY, now.getTime());
	}
	if (
		!(Number.isFinite(start) && Number.isFinite(end)) ||
		end < start ||
		end - start > MAX_RANGE_DAYS * DAY
	) {
		throw new Error(
			`Choose an increasing range of at most ${MAX_RANGE_DAYS} days, ending today or earlier.`,
		);
	}
	// A refresh precisely at midnight still needs a nonempty range.
	end = Math.max(end, start + 1);
	return {
		start: new Date(start).toISOString(),
		end: new Date(end).toISOString(),
		bucket: end - start > 2 * DAY ? "day" : "hour",
	};
}

/**
 * The same, for pages where a hand-edited query string is ordinary input: an unusable custom range
 * falls back to the page's default instead of replacing the table with an error.
 */
export function safeRange(
	search: RangeSearch,
	fallback: RangeKey,
	now = new Date(),
): ResolvedRange {
	try {
		return resolveRange(search, fallback, now);
	} catch {
		return resolveRange({}, fallback, now);
	}
}

/** What the range covers, in words, for the one line that says what is on screen. */
export function rangeLabel(search: RangeSearch, fallback: RangeKey): string {
	const period = search.period ?? fallback;
	if (period === "custom" && search.from && search.to) {
		return `${search.from} to ${search.to} UTC`;
	}
	return RANGES[period];
}
