import { ActivitySkeleton, BreakdownSkeleton } from "./ChartSkeleton";
import { TextSkeleton } from "#/shared/components/TextSkeleton";
import { CacheUsageSkeleton } from "./OverviewSkeleton";
import { ContentPanel } from "#/components/ui/card";

import {
	StatGridSkeleton,
	TableSkeleton,
	Skeleton,
} from "#/shared/components/Skeleton.tsx";

export function MetricsSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<ContentPanel className="@container min-w-0 p-5">
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					{["Period · UTC", "Operation", "Public model", "Deployment"].map(
						(label) => (
							<div key={label}>
								<div className="mb-2 font-medium text-sm">
									<TextSkeleton length={label.length} />
								</div>
								<Skeleton className="h-8 rounded-lg sm:h-7" />
							</div>
						),
					)}
				</div>
				<Skeleton className="mt-3 h-3" width="min(100%, 24rem)" />
			</ContentPanel>
			<StatGridSkeleton
				className="grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
				count={6}
				icon={false}
				note={false}
			/>
			<div className="grid gap-4 xl:grid-cols-2">
				<ActivitySkeleton source="requests" />
				<ActivitySkeleton source="attempts" />
			</div>
			<CacheUsageSkeleton />
			<BreakdownSkeleton />
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
				<section className="flex flex-col gap-3" key={headers.join()}>
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
