"use client";

import type { getOverviewMetrics } from "./overview-data";
import { Card } from "#/components/ui/card";

const count = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 1,
});

export function RequestOutcomes({
	metrics,
}: {
	metrics: ReturnType<typeof getOverviewMetrics>;
}) {
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
		<Card className="flex min-w-0 flex-col p-5">
			<h2 className="font-semibold">Request outcomes</h2>
			<p className="mt-1 text-xs text-fg-muted">
				Reliability across finished requests
			</p>
			<div className="mt-5 flex items-baseline gap-2">
				<span className="text-3xl font-semibold tracking-tight tabular-nums">
					{metrics.successRate === null
						? "—"
						: percent.format(metrics.successRate)}
				</span>
				<span className="text-xs text-fg-muted">success rate</span>
			</div>
			<div
				className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-2"
				aria-hidden
			>
				{outcomes.map(
					(row) =>
						row.value > 0 && (
							<span
								key={row.label}
								className={row.color}
								style={{
									width: `${metrics.finishedRequests > 0 ? (row.value / metrics.finishedRequests) * 100 : 0}%`,
								}}
							/>
						),
				)}
			</div>
			<dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
				{outcomes.map((row) => (
					<div
						key={row.label}
						className="flex min-w-0 items-center justify-between gap-2 text-xs"
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
				<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3 text-xs text-fg-muted tabular-nums">
					<span>{count.format(metrics.finishedRequests)} finished</span>
					<span>{count.format(metrics.outcomes.inProgress)} in progress</span>
				</div>
			</div>
		</Card>
	);
}
