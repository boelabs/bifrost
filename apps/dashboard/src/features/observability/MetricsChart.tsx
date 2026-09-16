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
	const format = (value: number | null, short = false) =>
		value === null
			? "—"
			: isDuration
				? duration(value)
				: (short ? compact : count).format(value);
	const date = new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		...(data.bucket === "hour"
			? ({ hour: "2-digit", minute: "2-digit" } as const)
			: {}),
		timeZone: "UTC",
	});
	const label = options.find((option) => option.key === metric)?.label;
	return (
		<Card className="min-w-0 p-7" aria-labelledby={id}>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 id={id} className="font-semibold">
						{upstream ? "Deployment activity" : "Request activity"}
					</h2>
					<p className="mt-1 text-xs text-fg-muted">
						{data.bucket === "hour" ? "Hourly" : "Daily"} · UTC
						{upstream ? " · includes retries" : ""}
					</p>
				</div>
				<ToggleGroup
					aria-label={
						upstream ? "Deployment chart metric" : "Request chart metric"
					}
					value={[metric]}
					onValueChange={(values) => {
						if (values[0]) setMetric(values[0]);
					}}
				>
					{options.map((option) => (
						<Toggle
							key={option.key}
							value={option.key}
							size="xs"
							variant="ghost"
						>
							{option.label}
						</Toggle>
					))}
				</ToggleGroup>
			</div>
			<figure className="mt-7" aria-label={`${label} over time`}>
				<div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
					<div
						className="flex h-40 flex-col justify-between text-right text-[10px] text-fg-muted tabular-nums"
						aria-hidden
					>
						{[1, 0.5, 0].map((fraction) => (
							<span key={fraction}>{format(max * fraction, true)}</span>
						))}
					</div>
					<div className="relative h-40">
						<div
							className="pointer-events-none absolute inset-0 flex flex-col justify-between"
							aria-hidden
						>
							{[0, 1, 2].map((i) => (
								<div
									key={i}
									className="border-t border-dashed border-border/60"
								/>
							))}
						</div>
						<div className="relative flex h-full gap-1">
							{rows.map((row) => (
								<button
									key={row.timestamp}
									type="button"
									className="flex min-w-0 flex-1 items-end rounded-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-focus"
									aria-label={`${date.format(row.timestamp)} UTC: ${format(row.value)} ${label}`}
									onPointerEnter={() => setActive(row.timestamp)}
									onFocus={() => setActive(row.timestamp)}
									onBlur={() => setActive(null)}
									onClick={() => setActive(row.timestamp)}
								>
									<span
										className={`w-full rounded-t-sm ${metric === "errors" ? "bg-danger" : upstream ? "bg-chart-2" : "bg-chart-1"} ${active === row.timestamp ? "opacity-100" : "opacity-70"}`}
										style={{
											height: `${max && row.value !== null ? (row.value / max) * 100 : 0}%`,
										}}
									/>
								</button>
							))}
						</div>
						{max === 0 && (
							<p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-fg-muted">
								{rows.some((row) => row.value !== null)
									? "No activity recorded for this metric"
									: "No measurements reported"}
							</p>
						)}
					</div>
					<div />
					<div
						className="flex justify-between gap-2 text-[10px] text-fg-muted"
						aria-hidden
					>
						<span>{date.format(Date.parse(data.start))}</span>
						<span>{date.format(Date.parse(data.end))}</span>
					</div>
				</div>
				<figcaption className="mt-4 flex min-h-10 items-center justify-between gap-3 border-t border-border/50 pt-3 text-xs">
					<span className="text-fg-muted">
						{selected
							? `${date.format(selected.timestamp)} UTC${selected.timestamp + (data.bucket === "day" ? 86_400_000 : 3_600_000) > Date.parse(data.end) ? " · partial interval" : ""}`
							: "Select a bar to inspect its value"}
					</span>
					<span className="font-medium tabular-nums">
						{selected ? format(selected.value) : label}
					</span>
				</figcaption>
			</figure>
		</Card>
	);
}
