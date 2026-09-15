"use client";

import type { UsageBucket, UsagePoint } from "./overview-data";
import { ToggleGroup } from "#/components/ui/toggle-group";
import { Toggle } from "#/components/ui/toggle";
import { Card } from "#/components/ui/card";
import { useId, useState } from "react";

const metrics = {
	requests: { label: "Requests", color: "bg-chart-1" },
	totalTokens: { label: "Tokens", color: "bg-chart-2" },
	consumerCostCents: { label: "Cost", color: "bg-chart-3" },
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
	if (bucket === "day") return `${startDay} UTC`;
	const endDay = date.format(row.intervalEnd);
	return `${startDay}, ${hour.format(row.intervalStart)}–${startDay === endDay ? "" : `${endDay}, `}${hour.format(row.intervalEnd)} UTC`;
}

/**
 * `bucket` is the range's decision, not this component's: an hour per bar reads well across a day
 * and turns into noise across a month, so a wide range arrives already grouped by day and only the
 * labels have to follow.
 */
export function ActivityChart({
	rows,
	bucket = "hour",
}: {
	rows: UsagePoint[];
	bucket?: UsageBucket;
}) {
	const titleId = useId();
	const [metric, setMetric] = useState<Metric>("requests");
	const [selectedHour, setSelectedHour] = useState<number | null>(null);
	const selected = rows.find((row) => row.timestamp === selectedHour);
	const total = rows.reduce((sum, row) => sum + row[metric], 0);
	const maximum = Math.max(0, ...rows.map((row) => row[metric]));
	const ticks = [
		...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1]),
	]
		.map((index) => rows[index])
		.filter((row): row is UsagePoint => Boolean(row));
	const metricInfo = metrics[metric];

	return (
		<Card className="min-w-0 p-5" aria-labelledby={titleId}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id={titleId} className="font-semibold">
						Activity
					</h2>
					<p className="mt-1 text-fg-muted text-xs">
						{bucket === "day" ? "Daily" : "Hourly"} usage · UTC
					</p>
				</div>
				<ToggleGroup
					aria-label="Activity metric"
					value={[metric]}
					onValueChange={(value) => {
						if (value[0]) setMetric(value[0]);
					}}
					className="max-w-full border-border/50"
				>
					{(Object.keys(metrics) as Metric[]).map((key) => (
						<Toggle key={key} value={key} size="xs" variant="ghost">
							{metrics[key].label}
						</Toggle>
					))}
				</ToggleGroup>
			</div>
			{maximum > 0 ? (
				<figure
					className="mt-6"
					aria-label={`${bucket === "day" ? "Daily" : "Hourly"} ${metricInfo.label.toLowerCase()}`}
					onPointerLeave={() => setSelectedHour(null)}
				>
					<div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 gap-y-3">
						<div
							className="relative h-32 text-right text-[10px] text-fg-muted tabular-nums sm:h-36"
							aria-hidden="true"
						>
							{[1, 0.5, 0].map((fraction) => (
								<span
									key={fraction}
									className="absolute right-0 -translate-y-1/2"
									style={{ top: `${(1 - fraction) * 100}%` }}
								>
									{formatValue(maximum * fraction, metric, true)}
								</span>
							))}
						</div>
						<div className="relative h-32 min-w-0 sm:h-36">
							<div
								className="pointer-events-none absolute inset-0 flex flex-col justify-between"
								aria-hidden="true"
							>
								{[0, 1, 2].map((line) => (
									<div
										key={line}
										className="border-border/50 border-t border-dashed"
									/>
								))}
							</div>
							<div className="relative flex h-full gap-0.5 sm:gap-1">
								{rows.map((row) => {
									const active = row.timestamp === selectedHour;
									return (
										<button
											key={row.timestamp}
											type="button"
											aria-label={`${intervalLabel(row, bucket)}: ${formatValue(row[metric], metric)} ${metricInfo.label.toLowerCase()}`}
											className={`flex h-full min-w-0 flex-1 cursor-pointer items-end rounded-sm focus-visible:outline-2 focus-visible:outline-focus ${active ? "bg-chart-1/10" : ""}`}
											onPointerEnter={() => setSelectedHour(row.timestamp)}
											onFocus={() => setSelectedHour(row.timestamp)}
											onBlur={() => setSelectedHour(null)}
											onClick={() => setSelectedHour(row.timestamp)}
										>
											<span
												className={`w-full rounded-t-sm ${metricInfo.color} ${active ? "opacity-100" : "opacity-65"}`}
												style={{ height: `${(row[metric] / maximum) * 100}%` }}
											/>
										</button>
									);
								})}
							</div>
						</div>
						<div />
						<div
							className="flex justify-between text-[10px] text-fg-muted tabular-nums"
							aria-hidden="true"
						>
							{ticks.map((row) => (
								<span key={row.timestamp}>
									{(bucket === "day" ? date : hour).format(row.timestamp)}
								</span>
							))}
						</div>
					</div>
					<figcaption className="mt-4 flex min-h-8 flex-wrap items-start justify-between gap-x-3 gap-y-1 border-border/50 border-t pt-3 text-xs">
						<span className="text-fg-muted">
							{selected
								? intervalLabel(selected, bucket)
								: `Total ${metricInfo.label.toLowerCase()}`}
						</span>
						<span className="font-medium tabular-nums">
							{formatValue(selected?.[metric] ?? total, metric)}
						</span>
					</figcaption>
				</figure>
			) : (
				<div className="flex min-h-56 flex-col items-center justify-center px-3 text-center">
					<p className="font-medium text-sm">
						No {metricInfo.label.toLowerCase()} recorded
					</p>
					<p className="mt-2 max-w-64 text-fg-muted text-xs leading-relaxed">
						{metric === "requests"
							? "Usage will appear here as the gateway receives traffic."
							: `There is no ${metric === "totalTokens" ? "token usage" : "billed cost"} in the selected period.`}
					</p>
				</div>
			)}
		</Card>
	);
}
