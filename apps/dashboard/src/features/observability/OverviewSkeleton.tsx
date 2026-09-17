import {
	StatGridSkeleton,
	ChartSkeleton,
	TableSkeleton,
	Skeleton,
} from "#/shared/components/Skeleton.tsx";

/** The same headers `usageColumns` and `actorColumns` render, so the tables land in place. */
const BY_MODEL = [
	"Public model",
	"Requests",
	"Total tokens",
	"Cached input",
	"Uncached input",
	"Cache writes",
	"Unclassified input",
	"Cost",
] as const;
const BY_ACTOR = ["Actor", ...BY_MODEL.slice(1)] as const;

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

			<div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<ChartSkeleton height="14rem" />
				<div className="grid content-start gap-5">
					<ChartSkeleton height="8.5rem" />
					<ChartSkeleton height="7rem" />
				</div>
			</div>

			<ChartSkeleton height="17rem" />
			<div className="grid items-start gap-5">
				{[
					{ headers: BY_MODEL, title: "9rem", caption: "16rem" },
					{ headers: BY_ACTOR, title: "5rem", caption: "18rem" },
				].map(({ headers, title, caption }) => (
					<section
						key={headers[0]}
						className="min-w-0 rounded-[var(--ui-radius-surface)] border border-border/50 bg-card p-7"
					>
						<div className="flex items-start justify-between gap-3">
							<div>
								<Skeleton className="h-5" width={title} />
								<Skeleton className="mt-2 h-3" width={caption} />
							</div>
							<Skeleton className="h-10 rounded-4xl" width="4.5rem" />
						</div>
						<TableSkeleton
							headers={headers}
							rows={10}
							widths={["60%", "40%", "45%", "50%"]}
							pagination
							plain
						/>
					</section>
				))}
			</div>

			<Skeleton className="mx-1 h-3" width="24rem" />
		</div>
	);
}
