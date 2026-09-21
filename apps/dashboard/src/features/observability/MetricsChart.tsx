"use client";

import { ToggleGroup } from "#/components/ui/toggle-group";
import { metricSeries, duration } from "./metrics-data";
import { Toggle } from "#/components/ui/toggle";
import type { DetailedMetrics } from "./api";
import { Card } from "#/components/ui/card";
import { useId, useState } from "react";

import {
	type ChartSeries,
	TimeSeriesChart,
	type ChartPoint,
} from "#/components/ui/chart";

const views = {
	requests: {
		label: "Traffic",
		kind: "area",
		series: [{ key: "requests", label: "Requests", color: "var(--chart-1)" }],
	},
	latency: {
		label: "Latency",
		kind: "line",
		series: [
			{ key: "p50DurationMs", label: "Median", color: "var(--chart-2)" },
			{ key: "p95DurationMs", label: "p95", color: "var(--chart-4)" },
		],
	},
	errors: {
		label: "Errors",
		kind: "bar",
		series: [{ key: "errors", label: "Errors", color: "var(--danger)" }],
	},
	tokens: {
		label: "Tokens",
		kind: "bar",
		series: [
			{ key: "promptTokens", label: "Input", color: "var(--chart-1)" },
			{ key: "completionTokens", label: "Output", color: "var(--chart-2)" },
		],
	},
	cache: {
		label: "Cache",
		kind: "bar",
		series: [
			{ key: "cacheReadTokens", label: "Cached", color: "var(--chart-2)" },
			{
				key: "uncachedInputTokens",
				label: "Uncached",
				color: "var(--chart-1)",
			},
			{
				key: "cacheUnreportedInputTokens",
				label: "Unclassified",
				color: "var(--chart-3)",
			},
		],
	},
	writes: {
		label: "Writes",
		kind: "bar",
		series: [
			{
				key: "cacheWriteTokens",
				label: "Cache writes",
				color: "var(--chart-4)",
			},
		],
	},
} satisfies Record<
	string,
	{ label: string; kind: "area" | "line" | "bar"; series: ChartSeries[] }
>;
type View = keyof typeof views;

export function MetricsChart({
	data,
	upstream = false,
}: {
	data: DetailedMetrics;
	upstream?: boolean;
}) {
	const id = useId();
	const options: View[] = upstream
		? ["tokens", "cache", "writes", "errors"]
		: ["requests", "latency", "errors"];
	const [view, setView] = useState<View>(options[0]);
	const config = views[view];
	const source = upstream ? "attemptSeries" : "series";
	const points = new Map<number, ChartPoint>();
	for (const item of config.series) {
		for (const point of metricSeries(data, source, item.key)) {
			const row = points.get(point.timestamp) ?? { timestamp: point.timestamp };
			row[item.key] = point.value;
			points.set(point.timestamp, row);
		}
	}
	const date = new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		timeZone: "UTC",
	});
	return (
		<Card aria-labelledby={id} className="min-w-0 overflow-hidden p-0">
			<div className="flex flex-wrap items-start justify-between gap-4 border-border/50 border-b px-7 py-5">
				<div>
					<h2 className="font-semibold" id={id}>
						{upstream ? "Deployment activity" : "Request activity"}
					</h2>
					<p className="mt-1 text-fg-muted text-xs">
						{data.bucket === "hour" ? "Hourly" : "Daily"} · UTC
						{upstream ? " · includes retries" : ""}
					</p>
				</div>
				<ToggleGroup
					aria-label={
						upstream ? "Deployment chart metric" : "Request chart metric"
					}
					className="flex-wrap"
					onValueChange={(values) => {
						if (values[0]) {
							setView(values[0]);
						}
					}}
					value={[view]}
				>
					{options.map((option) => (
						<Toggle key={option} size="xs" value={option} variant="ghost">
							{views[option].label}
						</Toggle>
					))}
				</ToggleGroup>
			</div>
			<div className="px-4 py-6 sm:px-7">
				<TimeSeriesChart
					bucket={data.bucket}
					formatTick={view === "latency" ? duration : undefined}
					formatValue={view === "latency" ? duration : undefined}
					intervalLabel={(timestamp) => {
						const end = Math.min(
							timestamp + (data.bucket === "day" ? 86_400_000 : 3_600_000),
							Date.parse(data.end),
						);
						return `${date.format(timestamp)} – ${date.format(end)} UTC`;
					}}
					key={view}
					kind={config.kind}
					label={
						config.label + (upstream ? " by deployment attempt" : " by request")
					}
					rows={[...points.values()]}
					series={config.series}
				/>
			</div>
		</Card>
	);
}
