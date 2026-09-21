"use client";

import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { chartTooltipStyle } from "#/components/ui/chart";
import { Card } from "#/components/ui/card";
import { compact } from "./metrics-data";
import { useId } from "react";

import {
	type CacheUsage as Usage,
	cacheReuseRate,
	tokenCount,
} from "./cache-usage";

export function CacheUsage({
	usage,
	records,
	upstream = false,
}: {
	usage: Usage;
	records: number;
	upstream?: boolean;
}) {
	const id = useId();
	const reuse = cacheReuseRate(usage);
	const unit = upstream ? "attempts" : "requests";
	const rows = [
		{
			label: "Cached input",
			value: usage.cacheReadTokens,
			detail: "Read from the provider's prompt cache",
			color: "bg-chart-2",
			fill: "var(--chart-2)",
		},
		{
			label: "Uncached input",
			value: usage.uncachedInputTokens,
			detail: "Not read from cache; includes cache writes",
			color: "bg-chart-1",
			fill: "var(--chart-1)",
		},
		{
			label: "Unclassified input",
			value: usage.cacheUnreportedInputTokens,
			detail: "Input reported without a cache read count",
			color: "bg-chart-3",
			fill: "var(--chart-3)",
		},
	];
	const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
	const segments = rows.filter((row) => (row.value ?? 0) > 0);
	const visibleRows = rows.filter((row) => row.value !== 0 || total === 0);
	return (
		<Card aria-labelledby={id} className="@container min-w-0 p-7">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 className="font-semibold" id={id}>
						{upstream
							? "Provider cache · deployment attempts"
							: "Input token usage"}
					</h2>
					<p className="mt-1 text-fg-muted text-xs">
						{upstream
							? "Includes retries and fallbacks. "
							: "Recorded request usage. "}
						Cache is part of input, already included in total tokens.
					</p>
				</div>
				<div className="text-right">
					<p className="font-semibold text-2xl tabular-nums">
						{reuse === null
							? "—"
							: new Intl.NumberFormat("en-US", {
									style: "percent",
									maximumFractionDigits: 1,
								}).format(reuse)}
					</p>
					<p className="text-fg-muted text-xs">
						Cache reuse · classified input
					</p>
				</div>
			</div>
			<div className="mt-6 grid @min-[40rem]:grid-cols-[14rem_minmax(0,1fr)] items-center @min-[40rem]:gap-8 gap-6">
				<div
					aria-label="Reported input token distribution"
					className="relative mx-auto h-56 w-56"
					role="img"
				>
					{total > 0 ? (
						<ResponsiveContainer height="100%" width="100%">
							<PieChart>
								<Pie
									data={segments}
									dataKey="value"
									innerRadius={76}
									isAnimationActive={false}
									nameKey="label"
									outerRadius={102}
									stroke="none"
								/>
								<Tooltip
									contentStyle={chartTooltipStyle}
									formatter={(value) => tokenCount(Number(value))}
								/>
							</PieChart>
						</ResponsiveContainer>
					) : (
						<div className="absolute inset-2 rounded-full border-[24px] border-secondary" />
					)}
					<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
						<span className="font-semibold text-2xl tabular-nums">
							{rows.some((row) => row.value != null)
								? compact.format(total)
								: "—"}
						</span>
						<span className="mt-1 text-fg-muted text-xs">input tokens</span>
					</div>
				</div>
				<dl className="min-w-0 divide-y divide-border/50">
					{visibleRows.map((row) => (
						<div
							className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4 first:pt-0 last:pb-0"
							key={row.label}
						>
							<dt className="flex items-center gap-2 text-sm">
								{(row.value ?? 0) > 0 && (
									<span
										aria-hidden
										className={`size-2.5 shrink-0 rounded-sm ${row.color}`}
									/>
								)}
								{row.label}
							</dt>
							<dd className="flex flex-wrap items-baseline gap-x-3 font-semibold tabular-nums">
								{tokenCount(row.value)}
								<span className="font-normal text-fg-muted text-xs">
									{row.value == null || total === 0
										? "—"
										: `${((row.value / total) * 100).toFixed(1)}%`}
								</span>
							</dd>
							<dd className="w-full text-fg-muted text-xs">{row.detail}</dd>
						</div>
					))}
				</dl>
			</div>

			<div className="mt-6 flex flex-wrap justify-between gap-3 border-border/50 border-t pt-4 text-fg-muted text-xs">
				<p>
					Cache writes:{" "}
					<span className="font-medium text-fg tabular-nums">
						{tokenCount(usage.cacheWriteTokens)}
					</span>{" "}
					tokens · {tokenCount(usage.cacheWriteReported)} /{" "}
					{tokenCount(records)} {unit} reported writes
				</p>
				<p>
					Cache reads reported: {tokenCount(usage.cacheReadReported)} /{" "}
					{tokenCount(records)} {unit}
				</p>
			</div>
			<p className="mt-3 text-fg-muted text-xs">
				— means not reported; 0 means a reported zero. Totals and percentages
				use available measurements, not estimated usage.
			</p>
		</Card>
	);
}
