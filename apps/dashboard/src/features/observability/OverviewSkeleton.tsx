import { TextSkeleton } from "#/shared/components/TextSkeleton";
import { ContentPanel } from "#/components/ui/card";

import {
	StatGridSkeleton,
	TableSkeleton,
	Skeleton,
} from "#/shared/components/Skeleton.tsx";

import {
	ReliabilitySkeleton,
	ActivitySkeleton,
	OutcomesSkeleton,
} from "./ChartSkeleton";

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
		<div className="flex flex-col gap-6">
			<StatGridSkeleton count={4} />

			<div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<ActivitySkeleton />
				<div className="grid content-start gap-4">
					<OutcomesSkeleton />
					<ReliabilitySkeleton />
				</div>
			</div>

			<CacheUsageSkeleton />
			<div className="grid items-start gap-4">
				{[
					{ headers: BY_MODEL, title: "9rem", caption: "16rem" },
					{ headers: BY_ACTOR, title: "5rem", caption: "18rem" },
				].map(({ headers, title, caption }) => (
					<ContentPanel className="min-w-0 p-5" key={headers[0]}>
						<div className="flex items-start justify-between gap-3">
							<div>
								<Skeleton className="h-5" width={title} />
								<Skeleton className="mt-2 h-3" width={caption} />
							</div>
							<Skeleton className="h-8 rounded-lg sm:h-7" width="4.5rem" />
						</div>
						<TableSkeleton
							headers={headers}
							pagination
							plain
							rows={10}
							widths={["60%", "40%", "45%", "50%"]}
						/>
					</ContentPanel>
				))}
			</div>

			<Skeleton className="mx-1 h-3" width="24rem" />
		</div>
	);
}

export function CacheUsageSkeleton() {
	return (
		<ContentPanel
			aria-busy="true"
			aria-label="Loading input usage"
			className="@container min-w-0 p-5"
			role="status"
		>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 className="font-semibold">
						<TextSkeleton length={17} />
					</h2>
					<p className="mt-1 text-xs">
						<TextSkeleton length={84} />
					</p>
				</div>
				<div className="text-right">
					<p className="font-semibold text-2xl tabular-nums">
						<TextSkeleton length={5} />
					</p>
					<p className="text-xs">
						<TextSkeleton length={30} />
					</p>
				</div>
			</div>
			<div className="mt-6 grid @min-[40rem]:grid-cols-[14rem_minmax(0,1fr)] items-center @min-[40rem]:gap-8 gap-6">
				<div
					aria-hidden
					className="mx-auto my-2 size-52 animate-pulse rounded-full border-[24px] border-fg/10 motion-reduce:animate-none"
				/>
				<div className="min-w-0 divide-y divide-border/50">
					{[0, 1, 2].map((row) => (
						<div
							className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4 first:pt-0 last:pb-0"
							key={row}
						>
							<div className="flex items-center gap-2 text-sm">
								<Skeleton className="size-2.5 shrink-0 rounded-sm" />
								<TextSkeleton length={16} />
							</div>
							<div className="flex items-baseline gap-x-3 font-semibold tabular-nums">
								<TextSkeleton length={6} />
								<span className="font-normal text-xs">
									<TextSkeleton length={5} />
								</span>
							</div>
							<p className="w-full text-xs">
								<TextSkeleton length={40} />
							</p>
						</div>
					))}
				</div>
			</div>
			<div className="mt-6 flex flex-wrap justify-between gap-3 border-border/50 border-t pt-4 text-xs">
				<p>
					<TextSkeleton length={64} />
				</p>
				<p>
					<TextSkeleton length={45} />
				</p>
			</div>
		</ContentPanel>
	);
}
