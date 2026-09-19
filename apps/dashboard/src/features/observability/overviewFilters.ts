import { type RangeKey, rangeSchema } from "#/shared/lib/range.ts";
import { z } from "zod/v4";

/**
 * The overview's query string: a time range, and nothing else.
 *
 * "Everything" is not offered here, unlike the logs table. Every number on this page is a rate or a
 * total over a window — p95 latency, cost per request, activity per interval — and an unbounded
 * window turns those into an average over the entire retention period, which describes no moment an
 * operator is looking for.
 */
export const OVERVIEW_PERIODS = [
	"today",
	"yesterday",
	"7d",
	"30d",
	"custom",
] as const satisfies readonly RangeKey[];

/**
 * Today, like the metrics page: the overview opens on the shift the operator is in, and a week of
 * history averages away the hour they came to look at. Every other window is one click away and
 * survives in the URL.
 */
export const DEFAULT_PERIOD: RangeKey = "today";

const schema = z.object(rangeSchema(OVERVIEW_PERIODS));

export type OverviewFilters = z.infer<typeof schema>;

export function parseOverviewFilters(
	params: Record<string, string | string[] | undefined>,
): OverviewFilters {
	return schema.parse(params);
}
