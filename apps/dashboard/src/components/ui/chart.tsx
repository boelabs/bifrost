"use client";

import { useId } from "react";

import {
	ResponsiveContainer,
	CartesianGrid,
	ComposedChart,
	Tooltip,
	XAxis,
	YAxis,
	Area,
	Line,
	Bar,
} from "recharts";

export interface ChartSeries {
	key: string;
	label: string;
	color: string;
}

export interface ChartPoint {
	timestamp: number;
	[key: string]: number | null;
}

const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const count = new Intl.NumberFormat("en-US");

export const chartTooltipStyle = {
	background: "var(--popover)",
	color: "var(--fg)",
	border: "1px solid var(--border)",
	borderRadius: "var(--ui-radius-item)",
	fontSize: 12,
};

/** Same-unit series only. Missing measurements remain gaps, including in stacked charts. */
export function TimeSeriesChart({
	rows,
	series,
	kind = "area",
	stacked = false,
	bucket,
	label,
	formatValue = (value) => count.format(value),
	formatTick = (value) => compact.format(value),
	intervalLabel,
}: {
	rows: ChartPoint[];
	series: readonly ChartSeries[];
	kind?: "area" | "bar" | "line";
	stacked?: boolean;
	bucket: "hour" | "day";
	label: string;
	formatValue?: (value: number) => string;
	formatTick?: (value: number) => string;
	intervalLabel?: (timestamp: number) => string;
}) {
	const id = useId().replaceAll(":", "");
	const date = new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		...(bucket === "hour"
			? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
			: { month: "short", day: "numeric" }),
	});
	const describe =
		intervalLabel ??
		((timestamp: number) =>
			`${new Date(timestamp).toLocaleString("en-US", { timeZone: "UTC" })} UTC`);
	const measured = rows.some((row) =>
		series.some((item) => row[item.key] != null),
	);
	const positive = rows.some((row) =>
		series.some((item) => (row[item.key] ?? 0) > 0),
	);
	return (
		<figure aria-label={label} className="flex min-w-0 flex-1 flex-col">
			<div className="relative h-64 min-h-64 w-full flex-1 text-xs">
				<ResponsiveContainer
					height="100%"
					minWidth={0}
					style={{ position: "absolute", inset: 0 }}
					width="100%"
				>
					<ComposedChart
						accessibilityLayer
						data={rows}
						margin={{ top: 12, right: 8, bottom: 4, left: 0 }}
					>
						<defs>
							{series.map((item) => (
								<linearGradient
									id={`${id}-${item.key}`}
									key={item.key}
									x1="0"
									x2="0"
									y1="0"
									y2="1"
								>
									<stop offset="0%" stopColor={item.color} stopOpacity={0.45} />
									<stop
										offset="100%"
										stopColor={item.color}
										stopOpacity={0.03}
									/>
								</linearGradient>
							))}
						</defs>
						<CartesianGrid
							stroke="var(--border)"
							strokeOpacity={0.55}
							vertical={false}
						/>
						<XAxis
							axisLine={false}
							dataKey="timestamp"
							minTickGap={40}
							tick={{ fill: "var(--fg-muted)", fontSize: 11 }}
							tickFormatter={(value: number) => date.format(value)}
							tickLine={false}
							tickMargin={12}
						/>
						<YAxis
							axisLine={false}
							domain={[0, "auto"]}
							tick={{ fill: "var(--fg-muted)", fontSize: 11 }}
							tickFormatter={formatTick}
							tickLine={false}
							width={56}
						/>
						<Tooltip
							contentStyle={chartTooltipStyle}
							cursor={{
								stroke: "var(--fg-muted)",
								strokeDasharray: "3 3",
								fill: "var(--fg)",
								fillOpacity: 0.04,
							}}
							filterNull={false}
							formatter={(value, name) => [
								value == null ? "Not reported" : formatValue(Number(value)),
								name,
							]}
							labelFormatter={(value) => describe(Number(value))}
						/>
						{series.map((item) => {
							const props = {
								dataKey: item.key,
								name: item.label,
								stroke: item.color,
								isAnimationActive: false,
								connectNulls: false,
							};
							if (kind === "bar") {
								return (
									<Bar
										{...props}
										fill={item.color}
										key={item.key}
										maxBarSize={28}
										radius={[3, 3, 0, 0]}
										stackId={stacked ? "total" : undefined}
									/>
								);
							}
							if (kind === "line") {
								return (
									<Line
										{...props}
										activeDot={{ r: 5 }}
										dot={{ r: 2, strokeWidth: 0, fill: item.color }}
										key={item.key}
										strokeWidth={2}
										type="monotone"
									/>
								);
							}
							return (
								<Area
									{...props}
									activeDot={{ r: 4 }}
									dot={rows.length === 1}
									fill={`url(#${id}-${item.key})`}
									key={item.key}
									stackId={stacked ? "total" : undefined}
									strokeWidth={2}
									type="monotone"
								/>
							);
						})}
					</ComposedChart>
				</ResponsiveContainer>
				{!positive && (
					<p className="pointer-events-none absolute inset-0 flex items-center justify-center text-fg-muted text-xs">
						{measured
							? "All recorded values are zero"
							: "No measurements reported"}
					</p>
				)}
			</div>
			<figcaption className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
				{series.map((item) => (
					<span className="flex items-center gap-2" key={item.key}>
						<span
							aria-hidden
							className="size-2.5 rounded-sm"
							style={{ background: item.color }}
						/>
						{item.label}
					</span>
				))}
			</figcaption>
			<details className="mt-4 text-fg-muted text-xs">
				<summary className="w-fit cursor-pointer rounded-full focus-visible:outline-2">
					View chart data
				</summary>
				<div className="mt-3 max-h-60 overflow-auto">
					<table className="w-full text-left tabular-nums">
						<caption className="sr-only">{label}</caption>
						<thead>
							<tr>
								<th className="p-2" scope="col">
									Interval · UTC
								</th>
								{series.map((item) => (
									<th className="p-2" key={item.key} scope="col">
										{item.label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr className="border-border/50 border-t" key={row.timestamp}>
									<th className="p-2 font-normal" scope="row">
										{describe(row.timestamp)}
									</th>
									{series.map((item) => (
										<td className="p-2" key={item.key}>
											{row[item.key] == null
												? "Not reported"
												: formatValue(Number(row[item.key]))}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</details>
		</figure>
	);
}
