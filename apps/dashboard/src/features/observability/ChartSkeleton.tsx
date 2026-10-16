import { SampleSkeleton, TextSkeleton } from "#/shared/components/TextSkeleton";
import { GhostSkeleton, Skeleton } from "#/shared/components/Skeleton";
import { ToggleGroup } from "#/components/ui/toggle-group";
import { Panel } from "#/shared/components/Panel";
import { Toggle } from "#/components/ui/toggle";

/**
 * Lets a chart panel's content fill the height the column beside it sets, so the plot grows instead
 * of leaving the tray showing below it. Lives here, in a module that is not `"use client"`, so the
 * skeletons rendered by Server Components read the string rather than a client reference.
 */
export const FILL_PANEL =
	"*:data-[slot=frame-panel]:flex *:data-[slot=frame-panel]:flex-1 *:data-[slot=frame-panel]:flex-col";

/** The chart's plot, legend, and disclosure reserve the same rows as TimeSeriesChart. */
export function TimeSeriesSkeleton({ series }: { series: readonly string[] }) {
	return (
		<div aria-hidden className="flex min-w-0 flex-1 flex-col">
			<Skeleton className="h-64 min-h-64 w-full flex-1 rounded-xl" />
			<div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
				{series.map((label) => (
					<span className="flex items-center gap-2" key={label}>
						<Skeleton className="size-2.5 rounded-sm" />
						<TextSkeleton length={label.length} />
					</span>
				))}
			</div>
			<div className="mt-4 text-xs">
				<TextSkeleton length={15} />
			</div>
		</div>
	);
}

export function ActivitySkeleton({
	source = "overview",
}: {
	source?: "overview" | "requests" | "attempts";
}) {
	const overview = source === "overview";
	const { title, options, captionLength } = {
		overview: {
			title: "Activity",
			options: ["Requests", "Tokens", "Cost"],
			captionLength: 32,
		},
		requests: {
			title: "Request activity",
			options: ["Traffic", "Latency", "Errors"],
			captionLength: 12,
		},
		attempts: {
			title: "Deployment activity",
			options: ["Tokens", "Cache", "Writes", "Errors"],
			captionLength: 31,
		},
	}[source];
	return (
		<Panel
			action={
				<GhostSkeleton>
					<ToggleGroup
						className={overview ? undefined : "flex-wrap"}
						value={[]}
					>
						{options.map((option) => (
							<Toggle
								disabled
								key={option}
								size="xs"
								value={option}
								variant="ghost"
							>
								{option}
							</Toggle>
						))}
					</ToggleGroup>
				</GhostSkeleton>
			}
			className={FILL_PANEL}
			description={<TextSkeleton length={captionLength} />}
			title={<h2>{title}</h2>}
		>
			{overview ? (
				<p className="mb-6 font-semibold text-2xl tabular-nums">
					<TextSkeleton length={5} />{" "}
					<span className="font-normal text-xs">
						<TextSkeleton length={21} />
					</span>
				</p>
			) : null}
			<TimeSeriesSkeleton
				series={source === "requests" ? ["Requests"] : ["Input", "Output"]}
			/>
		</Panel>
	);
}

export function BreakdownSkeleton() {
	return (
		<div className="grid gap-3 lg:grid-cols-2">
			<Panel
				description="Share of all requests by their latest outcome."
				title={<h2>Request outcomes</h2>}
			>
				<div className="flex flex-col gap-4">
					{[
						"Success",
						"Error",
						"Incomplete",
						"Blocked",
						"Cancelled",
						"Abandoned / unknown",
						"In progress",
					].map((label) => (
						<div key={label}>
							<div className="mb-2 flex items-center justify-between gap-3 text-xs">
								<SampleSkeleton>{label}</SampleSkeleton>
								<TextSkeleton length={12} />
							</div>
							<Skeleton className="h-4 rounded-r" />
						</div>
					))}
				</div>
			</Panel>
			<Panel
				description="Reported upstream usage, including retries. Reasoning and cache are subsets, not additional totals."
				title={<h2>Deployment token breakdown</h2>}
			>
				<div className="flex flex-col gap-4">
					{["Input", "Output"].map((label) => (
						<div key={label}>
							<div className="mb-2 flex justify-between gap-3 text-sm">
								<SampleSkeleton>{label}</SampleSkeleton>
								<TextSkeleton length={9} />
							</div>
							<Skeleton className="h-6 rounded-r" />
						</div>
					))}
				</div>
				<div className="mt-5 divide-y divide-border/50 text-sm">
					{["Reasoning", "Cache read", "Cache write", "Search units"].map(
						(label) => (
							<div className="flex justify-between gap-3 py-2" key={label}>
								<SampleSkeleton>{label}</SampleSkeleton>
								<TextSkeleton length={6} />
							</div>
						),
					)}
				</div>
				<p className="mt-3 text-xs">
					<TextSkeleton length={106} />
				</p>
			</Panel>
		</div>
	);
}

export function OutcomesSkeleton() {
	return (
		<Panel
			description="Reliability across finished requests"
			title={<h2>Request outcomes</h2>}
		>
			<div className="flex items-baseline gap-2">
				<span className="font-semibold text-[2rem] tabular-nums leading-none tracking-tight">
					<TextSkeleton length={5} />
				</span>
				<span className="text-xs">
					<TextSkeleton length={12} />
				</span>
			</div>
			<Skeleton className="mt-5 h-2.5 rounded-full" />
			<div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3.5">
				{["Successful", "Errors"].map((label) => (
					<div
						className="flex min-w-0 items-center justify-between gap-2 text-xs"
						key={label}
					>
						<span className="flex items-center gap-2">
							<Skeleton className="size-1.5 shrink-0 rounded-full" />
							<TextSkeleton length={label.length} />
						</span>
						<TextSkeleton length={5} />
					</div>
				))}
			</div>
			<div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-border/50 border-t pt-3 text-xs">
				<TextSkeleton length={14} />
				<TextSkeleton length={13} />
			</div>
		</Panel>
	);
}

export function ReliabilitySkeleton() {
	return (
		<Panel
			description="What it took to finish them, across all attempts"
			title={<h2>Delivery</h2>}
		>
			<div className="divide-y divide-border/50 text-sm">
				{[
					"Requests with retries",
					"Degraded",
					"Stalled streams",
					"Protocol errors",
				].map((label) => (
					<div
						className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
						key={label}
					>
						<SampleSkeleton>{label}</SampleSkeleton>
						<TextSkeleton length={3} />
					</div>
				))}
			</div>
		</Panel>
	);
}
