"use client";

import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { useRefresh } from "#/shared/lib/useRefresh.ts";
import type { MetricsSearch } from "./metrics-data.ts";
import type { DetailedMetrics } from "./api.ts";
import { Metrics } from "./Metrics.tsx";

/**
 * Wires the metrics view to the URL.
 *
 * `Metrics` itself stays a pure presentation component that reports a filter change; this is the one
 * place that knows it means "push a query string". It goes through a transition, so changing a
 * filter leaves the charts on screen with the previous window until the new one is ready, instead of
 * dropping to a skeleton. Refreshing belongs to the page header, outside this boundary, but its
 * pending state is read here too: both replace what is on screen, and the body says so.
 */
export function MetricsView({
	data,
	options,
	search,
}: {
	data: DetailedMetrics;
	options: Pick<DetailedMetrics, "models" | "deployments">;
	search: MetricsSearch;
}) {
	const { set, pending: navigating } = useSearchWriter(search);
	const { pending: refreshing } = useRefresh();
	return (
		<Metrics
			data={data}
			options={options}
			search={search}
			refreshing={navigating || refreshing}
			onChange={(patch) => set(patch)}
		/>
	);
}
