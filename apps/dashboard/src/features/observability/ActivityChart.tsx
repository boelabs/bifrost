"use client";

import type { UsageBucket, UsagePoint } from "./overview-data";
import { ToggleGroup } from "#/components/ui/toggle-group";
import { TimeSeriesChart } from "#/components/ui/chart";
import { Toggle } from "#/components/ui/toggle";
import { Card } from "#/components/ui/card";
import { useId, useState } from "react";

const metrics = {
	requests: { label: "Requests" },
	totalTokens: { label: "Tokens" },
	consumerCostCents: { label: "Cost" },
} as const;

type Metric = keyof typeof metrics;

const count = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const currency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});
const hour = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
	timeZone: "UTC",
});
const date = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

function formatValue(value: number, metric: Metric, short = false) {
	if (metric === "consumerCostCents") {
		return short && value >= 100_000
			? `$${compact.format(value / 100)}`
			: currency.format(value / 100);
	}
	return (short ? compact : count).format(value);
}

function intervalLabel(row: UsagePoint, bucket: UsageBucket) {
	const startDay = date.format(row.intervalStart);
	if (bucket === "day") {
		return `${startDay} UTC`;
	}
	const endDay = date.format(row.intervalEnd);
	return `${startDay}, ${hour.format(row.intervalStart)}–${startDay === endDay ? "" : `${endDay}, `}${hour.format(row.intervalEnd)} UTC`;
}

export function ActivityChart({
	rows,
	bucket = "hour",
}: {
	rows: UsagePoint[];
	bucket?: UsageBucket;
}) {
	const titleId = useId();
	const [metric, setMetric] = useState<Metric>("totalTokens");
	const series =
		metric === "totalTokens"
			? [
					{ key: "promptTokens", label: "Input", color: "var(--chart-1)" },
					{ key: "completionTokens", label: "Output", color: "var(--chart-2)" },
				]
			: [
					{
						key: metric,
						label: metrics[metric].label,
						color: metric === "requests" ? "var(--chart-1)" : "var(--chart-3)",
					},
				];
	const total = rows.reduce((sum, row) => sum + row[metric], 0);
	return (
		<Card
			aria-labelledby={titleId}
			className="flex min-w-0 flex-col overflow-hidden p-0"
		>
			<div className="flex flex-wrap items-center justify-between gap-4 border-border/50 border-b px-7 py-5">
				<div>
					<h2 className="font-semibold" id={titleId}>
						Activity
					</h2>
					<p className="mt-1 text-fg-muted text-xs">
						{bucket === "day" ? "Daily" : "Hourly"} usage · UTC
					</p>
				</div>
				<ToggleGroup
					aria-label="Activity metric"
					onValueChange={(values) => {
						if (values[0]) {
							setMetric(values[0]);
						}
					}}
					value={[metric]}
				>
					{(Object.keys(metrics) as Metric[]).map((key) => (
						<Toggle key={key} size="xs" value={key} variant="ghost">
							{metrics[key].label}
						</Toggle>
					))}
				</ToggleGroup>
			</div>
			<div className="flex flex-1 flex-col px-4 pt-7 pb-5 sm:px-7">
				<p className="mb-6 font-semibold text-2xl tabular-nums">
					{formatValue(total, metric, true)}{" "}
					<span className="font-normal text-fg-muted text-xs">
						{metrics[metric].label.toLowerCase()} in this period
					</span>
				</p>
				<TimeSeriesChart
					bucket={bucket}
					formatTick={(value) => formatValue(value, metric, true)}
					formatValue={(value) => formatValue(value, metric)}
					intervalLabel={(timestamp) => {
						const row = rows.find((point) => point.timestamp === timestamp);
						return row ? intervalLabel(row, bucket) : "";
					}}
					label={`${metrics[metric].label} over time`}
					rows={rows.map((row) => ({
						timestamp: row.timestamp,
						promptTokens: row.promptTokens,
						completionTokens: row.completionTokens,
						requests: row.requests,
						consumerCostCents: row.consumerCostCents,
					}))}
					series={series}
					stacked={metric === "totalTokens"}
				/>
			</div>
		</Card>
	);
}
