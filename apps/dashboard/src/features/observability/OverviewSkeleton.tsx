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
				<ChartSkeleton height="31rem" />
				<div className="grid content-start gap-5">
					<ChartSkeleton height="12rem" />
					<ChartSkeleton height="10rem" />
				</div>
			</div>

			<CacheUsageSkeleton />
			<div className="grid items-start gap-5">
				{[
					{ headers: BY_MODEL, title: "9rem", caption: "16rem" },
					{ headers: BY_ACTOR, title: "5rem", caption: "18rem" },
				].map(({ headers, title, caption }) => (
					<section
						className="min-w-0 rounded-(--ui-radius-surface) border border-border/50 bg-card p-7"
						key={headers[0]}
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
							pagination
							plain
							rows={10}
							widths={["60%", "40%", "45%", "50%"]}
						/>
					</section>
				))}
			</div>

			<Skeleton className="mx-1 h-3" width="24rem" />
		</div>
	);
}

export function CacheUsageSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading input usage"
			className="@container min-w-0 rounded-(--ui-radius-surface) border border-border/50 bg-card p-7"
			role="status"
		>
			<div className="flex justify-between gap-4">
				<div>
					<Skeleton className="h-5" width="10rem" />
					<Skeleton className="mt-2 h-3" width="min(100%, 18rem)" />
				</div>
				<Skeleton className="h-8" width="4rem" />
			</div>
			<div className="mt-6 grid @min-[40rem]:grid-cols-[14rem_minmax(0,1fr)] items-center @min-[40rem]:gap-8 gap-6">
				<div
					aria-hidden
					className="mx-auto my-2 size-52 animate-pulse rounded-full border-[24px] border-fg/10 motion-reduce:animate-none"
				/>
				<div className="space-y-7">
					{[0, 1, 2].map((row) => (
						<div key={row}>
							<div className="flex justify-between gap-4">
								<Skeleton width="8rem" />
								<Skeleton width="5rem" />
							</div>
							<Skeleton className="mt-2 h-3" width="65%" />
						</div>
					))}
				</div>
			</div>
			<div className="mt-6 border-border/50 border-t pt-4">
				<Skeleton className="h-3" width="70%" />
				<Skeleton className="mt-3 h-3" width="85%" />
			</div>
		</div>
	);
}
