"use client";

import { Card } from "#/components/ui/card";
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
		},
		{
			label: "Uncached input",
			value: usage.uncachedInputTokens,
			detail: "Not read from cache; includes cache writes",
			color: "bg-chart-1",
		},
		{
			label: "Unclassified input",
			value: usage.cacheUnreportedInputTokens,
			detail: "Input reported without a cache read count",
			color: "bg-chart-3",
		},
	];
	const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
	return (
		<Card className="min-w-0 p-7" aria-labelledby={id}>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 id={id} className="font-semibold">
						{upstream
							? "Provider cache · deployment attempts"
							: "Input token usage"}
					</h2>
					<p className="mt-1 text-xs text-fg-muted">
						{upstream
							? "Includes retries and fallbacks. "
							: "Recorded request usage. "}
						Cache is part of input, already included in total tokens.
					</p>
				</div>
				<div className="text-right">
					<p className="text-2xl font-semibold tabular-nums">
						{reuse === null
							? "—"
							: new Intl.NumberFormat("en-US", {
									style: "percent",
									maximumFractionDigits: 1,
								}).format(reuse)}
					</p>
					<p className="text-xs text-fg-muted">Reuse of classified input</p>
				</div>
			</div>
			<div
				className="mt-6 flex h-2 overflow-hidden rounded-full bg-secondary"
				aria-hidden
			>
				{rows.map((row) => (
					<div
						key={row.label}
						className={row.color}
						style={{
							width: `${total ? ((row.value ?? 0) / total) * 100 : 0}%`,
						}}
					/>
				))}
			</div>
			<dl className="mt-5 grid gap-5 sm:grid-cols-3">
				{rows.map((row) => (
					<div key={row.label}>
						<dt className="flex items-center gap-2 text-sm">
							<span
								className={`size-2 rounded-full ${row.color}`}
								aria-hidden
							/>
							{row.label}
						</dt>
						<dd className="mt-2 text-xl font-semibold tabular-nums">
							{tokenCount(row.value)}
						</dd>
						<dd className="mt-1 text-xs text-fg-muted">{row.detail}</dd>
					</div>
				))}
			</dl>
			<div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-border/50 pt-4 text-xs text-fg-muted">
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
			<p className="mt-3 text-xs text-fg-muted">
				— means not reported; 0 means a reported zero. Totals and percentages
				use available measurements, not estimated usage.
			</p>
		</Card>
	);
}
