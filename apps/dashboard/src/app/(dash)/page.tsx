import { OverviewSkeleton } from "#/features/observability/OverviewSkeleton.tsx";
import { Overview, SystemStatus } from "#/features/observability/Overview.tsx";
import { RefreshControls } from "#/shared/components/RefreshControls.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { summary, usage } from "#/features/observability/api.ts";
import { GhostSkeleton } from "#/shared/components/Skeleton.tsx";
import { rangeLabel, safeRange } from "#/shared/lib/range.ts";
import { Section } from "#/shared/components/Section.tsx";
import { Server as IconServer } from "lucide-react";
import { readiness } from "#/shared/api/health.ts";
import { PageHeader } from "#/components/ui/page";
import { Status } from "#/components/ui/status";
import { connection } from "next/server";
import { Suspense } from "react";

import {
	OverviewToolbarSkeleton,
	OverviewToolbar,
} from "#/features/observability/OverviewToolbar.tsx";

import {
	parseOverviewFilters,
	DEFAULT_PERIOD,
} from "#/features/observability/overviewFilters.ts";

type Params = PageProps<"/">["searchParams"];

/**
 * The page an operator leaves open on a second screen.
 *
 * Nothing above the boundaries touches the gateway, so the title, the refresh control and the
 * "Summary" heading belong to the route's App Shell and are on screen the instant the link is
 * clicked. The health badge, the range control and the body then stream in separately — a slow `/health/ready` must not hold up the
 * usage tables, and changing the window must not blank the control that changed it.
 */
export default function OverviewPage(props: PageProps<"/">) {
	return (
		<>
			<PageHeader
				actions={
					<div className="flex flex-wrap items-center gap-3">
						<Suspense
							fallback={
								<GhostSkeleton className="rounded-sm">
									<Status tone="success">
										<IconServer aria-hidden className="size-3.5" />
										all systems ready
									</Status>
								</GhostSkeleton>
							}
						>
							<Health />
						</Suspense>
						{/* The one page that ticks on its own: it is left open on a second screen. */}
						<RefreshControls auto />
					</div>
				}
				description="Traffic, consumption and reliability for a window you choose."
				title="Overview"
			/>

			{/* Billete's "Resumen": the period is the action of the section the tiles open. It has
			    its own boundary, for the URL it reads, so changing the window never blanks it. */}
			<Section
				action={
					<Suspense fallback={<OverviewToolbarSkeleton />}>
						<Range searchParams={props.searchParams} />
					</Suspense>
				}
				title="Summary"
			>
				<RouteBoundary resetHref="/" title="The overview could not be loaded">
					<Suspense fallback={<OverviewSkeleton />}>
						<Usage searchParams={props.searchParams} />
					</Suspense>
				</RouteBoundary>
			</Section>
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
			bucket={range.bucket}
			byActor={byActor}
			byInterval={byInterval}
			byModel={byModel}
			end={end}
			health={health}
			rangeLabel={rangeLabel(filters, DEFAULT_PERIOD)}
			start={start}
		/>
	);
}
