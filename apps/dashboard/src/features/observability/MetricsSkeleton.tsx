import { CacheUsageSkeleton } from "./OverviewSkeleton";

import {
	StatGridSkeleton,
	ChartSkeleton,
	TableSkeleton,
	Skeleton,
} from "#/shared/components/Skeleton.tsx";

export function MetricsSkeleton() {
	return (
		<div className="space-y-6">
			<div className="rounded-(--ui-radius-surface) border border-border/50 bg-card p-5">
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					{["Period", "Operation", "Model", "Deployment"].map((label) => (
						<div key={label}>
							<Skeleton className="mb-2 h-4" width="6rem" />
							<Skeleton className="h-10 rounded-full" />
						</div>
					))}
				</div>
				<Skeleton className="mt-3 h-3" width="min(100%, 24rem)" />
			</div>
			<StatGridSkeleton
				className="xl:grid-cols-3"
				count={6}
				icon={false}
				note={false}
			/>
			<div className="grid gap-4 xl:grid-cols-2">
				<ChartSkeleton height="22rem" />
				<ChartSkeleton height="22rem" />
			</div>
			<CacheUsageSkeleton />
			<div className="grid gap-5 lg:grid-cols-2">
				<ChartSkeleton height="25rem" />
				<ChartSkeleton height="25rem" />
			</div>
			{[
				[
					"Deployment",
					"Attempts",
					"Reported tokens",
					"Cached input",
					"Errors",
					"Error rate",
					"Latency p95",
				],
				[
					"Public model",
					"Requests",
					"Request tokens",
					"Errors",
					"Consumer cost",
					"Latency p95",
				],
				["Deployment", "Failure", "Phase", "Provider status", "Errors"],
			].map((headers) => (
				<section className="space-y-3" key={headers.join()}>
					<Skeleton className="h-5" width="10rem" />
					<Skeleton className="h-3" width="min(100%, 30rem)" />
					<TableSkeleton
						headers={headers}
						pagination
						rows={5}
						toolbar={headers[1] !== "Failure"}
					/>
				</section>
			))}
		</div>
	);
}
