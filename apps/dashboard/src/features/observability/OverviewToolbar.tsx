"use client";

import { OVERVIEW_PERIODS, DEFAULT_PERIOD } from "./overviewFilters.ts";
import { RangeFilter } from "#/shared/components/RangeFilter.tsx";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import type { OverviewFilters } from "./overviewFilters.ts";

/**
 * The overview's range control.
 *
 * It sits in the page header rather than inside `Overview`, next to the health badge that is also
 * true of the whole page: the window is what everything below is about, so it belongs where the page
 * says what it is showing, and it stays on screen while the numbers underneath stream in.
 */
export function OverviewToolbar({ filters }: { filters: OverviewFilters }) {
	const { filter } = useSearchWriter(filters);
	return (
		<RangeFilter
			fallback={DEFAULT_PERIOD}
			onChange={(patch) => filter(patch)}
			periods={OVERVIEW_PERIODS}
			value={filters}
		/>
	);
}
