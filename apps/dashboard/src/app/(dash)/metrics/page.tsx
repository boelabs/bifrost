import { MetricsSkeleton } from "#/features/observability/MetricsSkeleton.tsx";
import { MetricsView } from "#/features/observability/MetricsView.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { detailedMetrics } from "#/features/observability/api.ts";
import { PageHeader } from "#/components/ui/page";
import { connection } from "next/server";
import { Suspense } from "react";

import {
	metricsSearch,
	metricsWindow,
} from "#/features/observability/metrics-data.ts";

/**
 * Detailed metrics for a chosen window.
 *
 * One boundary rather than the header/body split the other pages use: the model and deployment
 * pickers are built from the metrics response, so the controls have nothing to show until the query
 * returns. `metricsWindow` throws on an impossible range — a custom window running backwards, or
 * longer than a month — and that message is what the boundary shows, next to a way out of it.
 */
export default function MetricsPage(props: PageProps<"/metrics">) {
	return (
		<>
			<PageHeader
				title="Metrics"
				description="Throughput, latency, cost and failure shape for a window you choose."
			/>
			<RouteBoundary title="Metrics could not be loaded" resetHref="/metrics">
				<Suspense fallback={<MetricsSkeleton />}>
					<Window searchParams={props.searchParams} />
				</Suspense>
			</RouteBoundary>
		</>
	);
}

async function Window({
	searchParams,
}: {
	searchParams: PageProps<"/metrics">["searchParams"];
}) {
	const search = metricsSearch.parse(await searchParams);
	// `metricsWindow` anchors relative periods ("today", "7d") to now, which a prerender has no value
	// for. `connection()` says so: this renders when a real request arrives, not at build time.
	await connection();
	const window = metricsWindow(search);
	const base = { ...window, operation: search.operation };
	const filtered = {
		...base,
		publicModel: search.publicModel,
		deploymentId: search.deploymentId,
	};
	/**
	 * The unfiltered query only runs when a filter is set, and only to keep the pickers populated:
	 * narrowing to one model must not remove every other model from the list that narrowed it.
	 */
	const [data, options] = await Promise.all([
		detailedMetrics(filtered),
		search.publicModel || search.deploymentId
			? detailedMetrics(base)
			: Promise.resolve(null),
	]);
	return <MetricsView data={data} options={options ?? data} search={search} />;
}
