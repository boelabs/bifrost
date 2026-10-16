import { ActivitySkeleton, BreakdownSkeleton } from "./ChartSkeleton";
import { TextSkeleton } from "#/shared/components/TextSkeleton";
import { CacheUsageSkeleton } from "./OverviewSkeleton";
import { Section } from "#/shared/components/Section";
import { ContentPanel } from "#/components/ui/card";

import {
	StatGridSkeleton,
	TableSkeleton,
	Skeleton,
} from "#/shared/components/Skeleton.tsx";

/** The three tables `Metrics` renders, with the headings and headers it gives them. */
const TABLES = [
	{
		title: "By deployment",
		description:
			"Select one to inspect its consumption and failures. Error rates use finished attempts; deleted deployments stay while their history is retained.",
		headers: [
			"Deployment",
			"Attempts",
			"Reported tokens",
			"Cached input",
			"Errors",
			"Error rate",
			"Latency p95",
		],
		toolbar: true,
	},
	{
		title: "By public model",
		description:
			"The model name clients request. Each request is counted once, even if it required several attempts.",
		headers: [
			"Public model",
			"Requests",
			"Request tokens",
			"Errors",
			"Consumer cost",
			"Latency p95",
		],
		toolbar: true,
	},
	{
		title: "Deployment failures",
		description:
			"Failed attempts, including failures recovered by retries or fallback.",
		headers: ["Deployment", "Failure", "Phase", "Provider status", "Errors"],
		toolbar: false,
	},
];

export function MetricsSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading metrics"
			className="flex flex-col gap-6"
			role="status"
		>
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
				<Skeleton className="mt-3 h-3" width="min(100%, 36rem)" />
			</ContentPanel>
			<StatGridSkeleton
				className="grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
				count={6}
				icon={false}
				note={false}
			/>
			<div className="grid gap-3 xl:grid-cols-2">
				<ActivitySkeleton source="requests" />
				<ActivitySkeleton source="attempts" />
			</div>
			<CacheUsageSkeleton upstream />
			<BreakdownSkeleton />
			{TABLES.map(({ title, description, headers, toolbar }) => (
				<Section description={description} key={title} title={title}>
					<TableSkeleton
						headers={headers}
						pagination
						rows={5}
						toolbar={toolbar}
					/>
				</Section>
			))}
		</div>
	);
}
