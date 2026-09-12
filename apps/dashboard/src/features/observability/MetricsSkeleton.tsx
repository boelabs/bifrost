import {
	StatGridSkeleton,
	ChartSkeleton,
	Skeleton,
} from "#/shared/components/Skeleton.tsx";

/**
 * Metrics while its window is being queried.
 *
 * Unlike the other pages, the filter row is part of this fallback rather than a boundary of its own:
 * the model and deployment pickers are populated from the metrics response itself, so there is
 * nothing to draw them from until it lands. Changing a filter later does *not* come back here — that
 * navigation runs in a transition, which keeps the previous window on screen.
 */
export function MetricsSkeleton() {
	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-2">
				{["9rem", "12rem", "14rem", "10rem"].map((width, index) => (
					<Skeleton
						// biome-ignore lint/suspicious/noArrayIndexKey: placeholder bars have no identity
						key={index}
						className="h-8 rounded-[var(--ui-radius-control)]"
						width={width}
					/>
				))}
				<Skeleton
					className="ml-auto h-8 rounded-[var(--ui-radius-control)]"
					width="5.5rem"
				/>
			</div>

			<StatGridSkeleton count={4} />

			<div className="grid gap-4 lg:grid-cols-2">
				<ChartSkeleton height="11rem" />
				<ChartSkeleton height="11rem" />
				<ChartSkeleton height="11rem" />
				<ChartSkeleton height="11rem" />
			</div>
		</div>
	);
}
