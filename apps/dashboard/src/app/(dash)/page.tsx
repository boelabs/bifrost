import { OverviewSkeleton } from "#/features/observability/OverviewSkeleton.tsx";
import { OverviewToolbar } from "#/features/observability/OverviewToolbar.tsx";
import { Overview, SystemStatus } from "#/features/observability/Overview.tsx";
import { RefreshControls } from "#/shared/components/RefreshControls.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { summary, usage } from "#/features/observability/api.ts";
import { rangeLabel, safeRange } from "#/shared/lib/range.ts";
import { Skeleton } from "#/shared/components/Skeleton.tsx";
import { readiness } from "#/shared/api/health.ts";
import { PageHeader } from "#/components/ui/page";
import { connection } from "next/server";
import { Suspense } from "react";

import {
	parseOverviewFilters,
	DEFAULT_PERIOD,
} from "#/features/observability/overviewFilters.ts";

type Params = PageProps<"/">["searchParams"];

/**
 * The page an operator leaves open on a second screen.
 *
 * Nothing above the boundaries touches the gateway, so the title and the refresh controls belong to
 * the route's App Shell and are on screen the instant the link is clicked. The health badge, the
 * range control and the body then stream in separately — a slow `/health/ready` must not hold up the
 * usage tables, and changing the window must not blank the control that changed it.
 */
export default function OverviewPage(props: PageProps<"/">) {
	return (
		<>
			<PageHeader
				title="Overview"
				description="Traffic, consumption and reliability for a window you choose."
			>
				<div className="flex flex-wrap items-center gap-3">
					<Suspense
						fallback={<Skeleton className="h-6 rounded-full" width="8.5rem" />}
					>
						<Health />
					</Suspense>
					{/* Its own boundary, for the URL the control reads. */}
					<Suspense
						fallback={<Skeleton className="h-8 rounded-md" width="8.5rem" />}
					>
						<Range searchParams={props.searchParams} />
					</Suspense>
					{/* On by default here, unlike every other page. */}
					<RefreshControls auto />
				</div>
			</PageHeader>

			<RouteBoundary title="The overview could not be loaded" resetHref="/">
				<Suspense fallback={<OverviewSkeleton />}>
					<Usage searchParams={props.searchParams} />
				</Suspense>
			</RouteBoundary>
		</>
	);
}

async function Range({ searchParams }: { searchParams: Params }) {
	return <OverviewToolbar filters={parseOverviewFilters(await searchParams)} />;
}

async function Health() {
	return <SystemStatus ready={await readiness()} />;
}

async function Usage({ searchParams }: { searchParams: Params }) {
	const filters = parseOverviewFilters(await searchParams);
	// The window is anchored to today, which a prerender has no value for. `connection()` says so
	// explicitly: this component renders when a real request arrives, not at build time.
	await connection();
	// A hand-edited range falls back to the default rather than replacing the page with an error:
	// this is the screen someone leaves open, and it should always have something on it.
	const range = safeRange(filters, DEFAULT_PERIOD);
	const start = range.start ?? new Date().toISOString();
	const end = range.end ?? new Date().toISOString();
	// Usage accepts an inclusive end; the series buckets use [start, end).
	const window = { start, end: new Date(Date.parse(end) - 1).toISOString() };
	const [health, byModel, byActor, byInterval] = await Promise.all([
		summary({ start, end }),
		usage({ groupBy: "public_model", ...window }),
		usage({ groupBy: "actor", ...window }),
		usage({ groupBy: range.bucket, ...window }),
	]);
	return (
		<Overview
			health={health}
			byModel={byModel}
			byActor={byActor}
			byInterval={byInterval}
			start={start}
			end={end}
			bucket={range.bucket}
			rangeLabel={rangeLabel(filters, DEFAULT_PERIOD)}
		/>
	);
}
