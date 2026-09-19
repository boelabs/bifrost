"use client";

import type { getOverviewMetrics } from "./overview-data";
import { Card } from "#/components/ui/card";

type Metrics = ReturnType<typeof getOverviewMetrics>;

const count = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 1,
});

function share(rate: number | null): string {
	return rate === null ? "—" : percent.format(rate);
}

/**
 * How finished requests ended: the headline rate, the proportions as one bar, and the counts.
 *
 * Paired with `Reliability` in the column beside the activity chart. They are two cards rather than
 * one because they answer different questions — what the caller got back, and what the gateway had
 * to do to deliver it — and stacking them fills the column the chart sets the height of.
 */
export function RequestOutcomes({ metrics }: { metrics: Metrics }) {
	const outcomes = [
		{
			label: "Successful",
			value: metrics.outcomes.success,
			color: "bg-success",
		},
		{ label: "Errors", value: metrics.outcomes.error, color: "bg-danger" },
		{
			label: "Incomplete",
			value: metrics.outcomes.incomplete,
			color: "bg-warning",
		},
		{
			label: "Cancelled",
			value: metrics.outcomes.cancelled,
			color: "bg-chart-2",
		},
		{ label: "Blocked", value: metrics.outcomes.blocked, color: "bg-chart-3" },
		{
			label: "Abandoned",
			value: metrics.outcomes.abandoned,
			color: "bg-chart-4",
		},
		{ label: "Other", value: metrics.outcomes.unknown, color: "bg-chart-5" },
	].filter(
		(row) =>
			row.value > 0 || row.label === "Successful" || row.label === "Errors",
	);

	return (
		<Card className="flex min-w-0 flex-col p-7">
			<h2 className="font-semibold">Request outcomes</h2>
			<p className="mt-1 text-fg-muted text-xs">
				Reliability across finished requests
			</p>
			<div className="mt-5 flex items-baseline gap-2">
				<span className="font-semibold text-[2rem] tabular-nums leading-none tracking-tight">
					{share(metrics.successRate)}
				</span>
				<span className="text-fg-muted text-xs">success rate</span>
			</div>
			<div
				aria-hidden
				className="mt-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-2"
			>
				{outcomes.map(
					(row) =>
						row.value > 0 && (
							<span
								className={row.color}
								key={row.label}
								style={{
									width: `${metrics.finishedRequests > 0 ? (row.value / metrics.finishedRequests) * 100 : 0}%`,
								}}
							/>
						),
				)}
			</div>
			<dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3.5">
				{outcomes.map((row) => (
					<div
						className="flex min-w-0 items-center justify-between gap-2 text-xs"
						key={row.label}
					>
						<dt className="flex items-center gap-2 text-fg-muted">
							<span
								aria-hidden
								className={`size-1.5 shrink-0 rounded-full ${row.color}`}
							/>
							{row.label}
						</dt>
						<dd className="font-medium tabular-nums">
							{count.format(row.value)}
						</dd>
					</div>
				))}
			</dl>
			<div className="mt-auto pt-5">
				<div className="flex flex-wrap items-center justify-between gap-2 border-border/50 border-t pt-3 text-fg-muted text-xs tabular-nums">
					<span>{count.format(metrics.finishedRequests)} finished</span>
					<span>{count.format(metrics.outcomes.inProgress)} in progress</span>
				</div>
			</div>
		</Card>
	);
}

/**
 * What the gateway had to do behind those outcomes.
 *
 * A request that succeeded after three attempts and one that succeeded first time are the same row
 * in the card above; these are the counters that tell them apart, and the summary already carries
 * them.
 */
export function Reliability({ metrics }: { metrics: Metrics }) {
	const rows = [
		{
			label: "Requests with retries",
			value: count.format(metrics.retried),
			detail: share(metrics.retryRate),
		},
		{
			label: "Degraded",
			value: count.format(metrics.degraded),
			detail: share(metrics.degradedRate),
		},
		{ label: "Stalled streams", value: count.format(metrics.stalls) },
		{ label: "Protocol errors", value: count.format(metrics.protocolErrors) },
	];
	return (
		<Card className="flex min-w-0 flex-col p-7">
			<h2 className="font-semibold">Delivery</h2>
			<p className="mt-1 text-fg-muted text-xs">
				What it took to finish them, across all attempts
			</p>
			<dl className="mt-4 divide-y divide-border/50 text-sm">
				{rows.map((row) => (
					<div
						className="flex items-center justify-between gap-3 py-2.5"
						key={row.label}
					>
						<dt className="text-fg-muted">{row.label}</dt>
						<dd className="flex items-baseline gap-2 tabular-nums">
							<span className="font-medium">{row.value}</span>
							{row.detail ? (
								<span className="text-fg-muted text-xs">{row.detail}</span>
							) : null}
						</dd>
					</div>
				))}
			</dl>
		</Card>
	);
}
