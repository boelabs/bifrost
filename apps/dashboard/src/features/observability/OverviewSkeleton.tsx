import { TextSkeleton } from "#/shared/components/TextSkeleton";
import { Section } from "#/shared/components/Section";
import { Panel } from "#/shared/components/Panel";

import {
	StatGridSkeleton,
	ButtonSkeleton,
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
 * Every grid here repeats the real component's own layout classes, so the four tiles, the panels
 * and the two tables are already in their final positions — when the data arrives only the contents
 * of the boxes change, and nothing on the page moves.
 */
export function OverviewSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading overview"
			className="flex flex-col gap-6"
			role="status"
		>
			<StatGridSkeleton count={4} />

			<div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<ActivitySkeleton />
				<div className="grid min-w-0 content-start gap-3">
					<OutcomesSkeleton />
					<ReliabilitySkeleton />
				</div>
			</div>

			<CacheUsageSkeleton />
			{[
				{
					headers: BY_MODEL,
					title: "By public model",
					description:
						"Total = input + output. Cached, uncached and unclassified counts split the reported input.",
				},
				{
					headers: BY_ACTOR,
					title: "By actor",
					description:
						"Includes operator traffic from the playground and manual tests.",
				},
			].map(({ headers, title, description }) => (
				<Section
					action={<ButtonSkeleton label={6} />}
					description={description}
					key={title}
					title={
						<>
							{title} · <TextSkeleton length={5} />
						</>
					}
				>
					<TableSkeleton
						headers={headers}
						pagination
						rows={10}
						widths={["60%", "40%", "45%", "50%"]}
					/>
				</Section>
			))}
		</div>
	);
}

export function CacheUsageSkeleton({
	upstream = false,
}: {
	upstream?: boolean;
}) {
	return (
		<Panel
			description={
				<>
					{upstream
						? "Includes retries and fallbacks. "
						: "Recorded request usage. "}
					Cache is part of input, already included in total tokens.
				</>
			}
			title={
				<h2>
					{upstream
						? "Provider cache · deployment attempts"
						: "Input token usage"}
				</h2>
			}
		>
			<div className="@container">
				<p className="font-semibold text-2xl tabular-nums">
					<TextSkeleton length={5} />{" "}
					<span className="font-normal text-xs">
						<TextSkeleton length={30} />
					</span>
				</p>
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
				<p className="mt-3 text-xs">
					<TextSkeleton length={106} />
				</p>
			</div>
		</Panel>
	);
}
