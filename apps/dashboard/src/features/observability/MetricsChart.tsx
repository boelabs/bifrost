"use client";

import { compact, count, duration, metricSeries } from "./metrics-data";
import { ToggleGroup } from "#/components/ui/toggle-group";
import { Toggle } from "#/components/ui/toggle";
import type { DetailedMetrics } from "./api";
import { Card } from "#/components/ui/card";
import { useId, useState } from "react";

const requestOptions = [
	{ key: "requests", label: "Requests" },
	{ key: "errors", label: "Errors" },
	{ key: "p95DurationMs", label: "Latency p95" },
];
const attemptOptions = [
	{ key: "totalTokens", label: "Total" },
	{ key: "promptTokens", label: "Input" },
	{ key: "completionTokens", label: "Output" },
	{ key: "cacheReadTokens", label: "Cached" },
	{ key: "uncachedInputTokens", label: "Uncached" },
	{ key: "cacheWriteTokens", label: "Writes" },
	{ key: "cacheUnreportedInputTokens", label: "Unclassified" },
	{ key: "errors", label: "Errors" },
];

export function MetricsChart({
	data,
	upstream = false,
}: {
	data: DetailedMetrics;
	upstream?: boolean;
}) {
	const id = useId();
	const options = upstream ? attemptOptions : requestOptions;
	const [metric, setMetric] = useState(options[0].key);
	const [active, setActive] = useState<number | null>(null);
	const rows = metricSeries(
		data,
		upstream ? "attemptSeries" : "series",
		metric,
	);
	const max = Math.max(0, ...rows.map((row) => row.value ?? 0));
	const selected = rows.find((row) => row.timestamp === active);
	const isDuration = metric === "p95DurationMs";
	const format = (value: number | null, short = false) => {
		if (value === null) {
			return "—";
		}
		if (isDuration) {
			return duration(value);
		}
		return (short ? compact : count).format(value);
	};
	const date = new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		...(data.bucket === "hour"
			? ({ hour: "2-digit", minute: "2-digit" } as const)
			: {}),
		timeZone: "UTC",
	});
	const label = options.find((option) => option.key === metric)?.label;
	let barColor = "bg-chart-1";
	if (metric === "errors") {
		barColor = "bg-danger";
	} else if (upstream) {
		barColor = "bg-chart-2";
	}
	/** The bar's value once one is picked, and the metric's name until then. */
	const readout = selected ? format(selected.value) : label;
	return (
		<Card aria-labelledby={id} className="min-w-0 p-7">
			<div className="flex flex-wrap items-start justify-between gap-3">
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
							setMetric(values[0]);
						}
					}}
					value={[metric]}
				>
					{options.map((option) => (
						<Toggle
							key={option.key}
							size="xs"
							value={option.key}
							variant="ghost"
						>
							{option.label}
						</Toggle>
					))}
				</ToggleGroup>
			</div>
			<figure aria-label={`${label} over time`} className="mt-7">
				<div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
					<div
						aria-hidden
						className="flex h-40 flex-col justify-between text-right text-[10px] text-fg-muted tabular-nums"
					>
						{[1, 0.5, 0].map((fraction) => (
							<span key={fraction}>{format(max * fraction, true)}</span>
						))}
					</div>
					<div className="relative h-40">
						<div
							aria-hidden
							className="pointer-events-none absolute inset-0 flex flex-col justify-between"
						>
							{[0, 1, 2].map((i) => (
								<div
									className="border-border/60 border-t border-dashed"
									key={i}
								/>
							))}
						</div>
						<div className="relative flex h-full gap-1">
							{rows.map((row) => (
								<button
									aria-label={`${date.format(row.timestamp)} UTC: ${format(row.value)} ${label}`}
									className="flex min-w-0 flex-1 items-end rounded-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-focus"
									key={row.timestamp}
									onBlur={() => setActive(null)}
									onClick={() => setActive(row.timestamp)}
									onFocus={() => setActive(row.timestamp)}
									onPointerEnter={() => setActive(row.timestamp)}
									type="button"
								>
									<span
										className={`w-full rounded-t-sm ${barColor} ${active === row.timestamp ? "opacity-100" : "opacity-70"}`}
										style={{
											height: `${max && row.value !== null ? (row.value / max) * 100 : 0}%`,
										}}
									/>
								</button>
							))}
						</div>
						{max === 0 && (
							<p className="pointer-events-none absolute inset-0 flex items-center justify-center text-fg-muted text-xs">
								{rows.some((row) => row.value !== null)
									? "No activity recorded for this metric"
									: "No measurements reported"}
							</p>
						)}
					</div>
					<div />
					<div
						aria-hidden
						className="flex justify-between gap-2 text-[10px] text-fg-muted"
					>
						<span>{date.format(Date.parse(data.start))}</span>
						<span>{date.format(Date.parse(data.end))}</span>
					</div>
				</div>
				<figcaption className="mt-4 flex min-h-10 items-center justify-between gap-3 border-border/50 border-t pt-3 text-xs">
					<span className="text-fg-muted">
						{selected
							? `${date.format(selected.timestamp)} UTC${selected.timestamp + (data.bucket === "day" ? 86_400_000 : 3_600_000) > Date.parse(data.end) ? " · partial interval" : ""}`
							: "Select a bar to inspect its value"}
					</span>
					<span className="font-medium tabular-nums">{readout}</span>
				</figcaption>
			</figure>
		</Card>
	);
}
