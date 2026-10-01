import { SampleSkeleton, TextSkeleton } from "#/shared/components/TextSkeleton";
import { GhostSkeleton, Skeleton } from "#/shared/components/Skeleton";
import { ToggleGroup } from "#/components/ui/toggle-group";
import { ContentPanel } from "#/components/ui/card";
import { Toggle } from "#/components/ui/toggle";

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
			captionLength: 18,
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
		<ContentPanel
			aria-busy="true"
			aria-label={`Loading ${title.toLowerCase()}`}
			className="flex min-w-0 flex-col overflow-hidden p-0"
			role="status"
		>
			<div
				className={`flex flex-wrap ${overview ? "items-center" : "items-start"} justify-between gap-4 border-border/50 border-b px-5 py-4`}
			>
				<div>
					<h2 className="font-semibold text-sm">
						<TextSkeleton length={title.length} />
					</h2>
					<p className="mt-1 text-xs">
						<TextSkeleton length={captionLength} />
					</p>
				</div>
				<GhostSkeleton>
					<ToggleGroup className="flex-wrap" value={[]}>
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
			</div>
			<div className="flex flex-1 flex-col p-5">
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
			</div>
		</ContentPanel>
	);
}

export function BreakdownSkeleton() {
	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<ContentPanel
				aria-busy="true"
				aria-label="Loading outcome breakdown"
				className="p-5"
				role="status"
			>
				<h2 className="font-semibold">
					<SampleSkeleton>Request outcomes</SampleSkeleton>
				</h2>
				<p className="mt-1 text-xs">
					<SampleSkeleton>
						Share of all requests by their latest outcome.
					</SampleSkeleton>
				</p>
				<div className="mt-6 flex flex-col gap-4">
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
			</ContentPanel>
			<ContentPanel
				aria-busy="true"
				aria-label="Loading token breakdown"
				className="p-5"
				role="status"
			>
				<h2 className="font-semibold">
					<SampleSkeleton>Deployment token breakdown</SampleSkeleton>
				</h2>
				<p className="mt-1 text-xs">
					<SampleSkeleton>
						Reported upstream usage, including retries. Reasoning and cache are
						subsets, not additional totals.
					</SampleSkeleton>
				</p>
				<div className="mt-6 flex flex-col gap-4">
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
			</ContentPanel>
		</div>
	);
}

export function OutcomesSkeleton() {
	return (
		<ContentPanel
			aria-busy="true"
			aria-label="Loading request outcomes"
			className="flex min-w-0 flex-col p-5"
			role="status"
		>
			<h2 className="font-semibold">
				<TextSkeleton length={16} />
			</h2>
			<p className="mt-1 text-xs">
				<TextSkeleton length={36} />
			</p>
			<div className="mt-5 flex items-baseline gap-2">
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
			<div className="mt-auto pt-5">
				<div className="flex flex-wrap items-center justify-between gap-2 border-border/50 border-t pt-3 text-xs">
					<TextSkeleton length={14} />
					<TextSkeleton length={13} />
				</div>
			</div>
		</ContentPanel>
	);
}

export function ReliabilitySkeleton() {
	return (
		<ContentPanel
			aria-busy="true"
			aria-label="Loading delivery"
			className="flex min-w-0 flex-col p-5"
			role="status"
		>
			<h2 className="font-semibold">
				<TextSkeleton length={8} />
			</h2>
			<p className="mt-1 text-xs">
				<TextSkeleton length={45} />
			</p>
			<div className="mt-4 divide-y divide-border/50 text-sm">
				{[
					"Requests with retries",
					"Degraded",
					"Stalled streams",
					"Protocol errors",
				].map((label) => (
					<div
						className="flex items-center justify-between gap-3 py-2.5"
						key={label}
					>
						<TextSkeleton length={label.length} />
						<TextSkeleton length={3} />
					</div>
				))}
			</div>
		</ContentPanel>
	);
}
