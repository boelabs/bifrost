import {
	StatGridSkeleton,
	ChartSkeleton,
	TableSkeleton,
	Skeleton,
} from "#/shared/components/Skeleton.tsx";

/** The same headers `usageColumns` and `actorColumns` render, so the tables land in place. */
const BY_MODEL = ["Public model", "Requests", "Tokens", "Cost"] as const;
const BY_ACTOR = ["Actor", "Requests", "Cost"] as const;

/**
 * The overview while its numbers are in flight.
 *
 * Every grid here repeats the real component's own layout classes, so the four tiles, the two panels
 * and the two tables are already in their final positions — when the data arrives only the contents
 * of the boxes change, and nothing on the page moves.
 */
export function OverviewSkeleton() {
	return (
		<div className="space-y-6">
			<StatGridSkeleton count={4} />

			<div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<ChartSkeleton height="9rem" />
				<ChartSkeleton height="9rem" />
			</div>

			<div className="grid gap-x-4 gap-y-3 lg:grid-cols-2">
				{[
					{ headers: BY_MODEL, title: "9rem", caption: "16rem" },
					{ headers: BY_ACTOR, title: "5rem", caption: "18rem" },
				].map(({ headers, title, caption }) => (
					<section key={headers[0]} className="grid min-w-0 gap-3">
						<div className="flex items-start justify-between gap-3 px-1">
							<div>
								<Skeleton className="h-5" width={title} />
								<Skeleton className="mt-2 h-3" width={caption} />
							</div>
							<Skeleton className="h-8" width="4.5rem" />
						</div>
						<TableSkeleton
							headers={headers}
							rows={10}
							widths={["60%", "40%", "45%", "50%"]}
							pagination
						/>
					</section>
				))}
			</div>

			<Skeleton className="mx-1 h-3" width="24rem" />
		</div>
	);
}
