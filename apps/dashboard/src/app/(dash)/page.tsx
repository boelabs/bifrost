import { OverviewSkeleton } from "#/features/observability/OverviewSkeleton.tsx";
import { Overview, SystemStatus } from "#/features/observability/Overview.tsx";
import { RefreshControls } from "#/shared/components/RefreshControls.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { summary, usage } from "#/features/observability/api.ts";
import { Skeleton } from "#/shared/components/Skeleton.tsx";
import { readiness } from "#/shared/api/health.ts";
import { PageHeader } from "#/components/ui/page";
import { IconClock } from "@tabler/icons-react";
import { Status } from "#/components/ui/status";
import { connection } from "next/server";
import { Suspense } from "react";

/**
 * The page an operator leaves open on a second screen.
 *
 * Nothing above the boundaries touches the gateway, so the title, the window badge and the refresh
 * controls belong to the route's App Shell and are on screen the instant the link is clicked. The
 * health badge and the body then stream in separately — a slow `/health/ready` must not hold up the
 * usage tables, and vice versa.
 */
export default function OverviewPage() {
	return (
		<>
			<PageHeader
				title="Overview"
				description="Traffic, consumption and reliability at a glance."
			>
				<div className="flex flex-wrap items-center gap-3">
					<Suspense
						fallback={<Skeleton className="h-6 rounded-full" width="8.5rem" />}
					>
						<Health />
					</Suspense>
					<Status tone="muted">
						<IconClock aria-hidden className="size-3.5" />
						Last 24 hours
					</Status>
					{/* On by default here, unlike every other page. */}
					<RefreshControls auto />
				</div>
			</PageHeader>

			<RouteBoundary title="The overview could not be loaded">
				<Suspense fallback={<OverviewSkeleton />}>
					<Usage />
				</Suspense>
			</RouteBoundary>
		</>
	);
}

async function Health() {
	return <SystemStatus ready={await readiness()} />;
}

async function Usage() {
	// The window is anchored to "now", which a prerender has no value for. `connection()` says so
	// explicitly: this component renders when a real request arrives, not at build time.
	await connection();
	const end = new Date().toISOString();
	const start = new Date(Date.parse(end) - 24 * 3_600_000).toISOString();
	// Usage accepts an inclusive end; hourly buckets use [start, end).
	const window = { start, end: new Date(Date.parse(end) - 1).toISOString() };
	const [health, byModel, byActor, byHour] = await Promise.all([
		summary("24h"),
		usage({ groupBy: "public_model", ...window }),
		usage({ groupBy: "actor", ...window }),
		usage({ groupBy: "hour", ...window }),
	]);
	return (
		<Overview
			health={health}
			byModel={byModel}
			byActor={byActor}
			byHour={byHour}
			start={start}
			end={end}
		/>
	);
}
