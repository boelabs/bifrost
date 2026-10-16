"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { buildUsageSeries, getOverviewMetrics } from "./overview-data";
import { type StatusProps, Status } from "#/components/ui/status";
import { RequestOutcomes, Reliability } from "./RequestOutcomes";
import { aggregateCacheUsage, tokenCount } from "./cache-usage";
import type { Readiness } from "#/shared/api/health.ts";
import { Section } from "#/shared/components/Section";
import type { UsageBucket } from "./overview-data";
import { EmptyState } from "#/components/ui/page";
import { downloadCsv } from "#/shared/lib/csv.ts";
import { ActivityChart } from "./ActivityChart";
import { Button } from "#/components/ui/button";
import type { LucideIcon } from "lucide-react";
import type { Summary, UsageRow } from "./api";
import { CacheUsage } from "./CacheUsage";
import { StatCard } from "./StatCard";

import {
	DollarSign as IconCurrencyDollar,
	Activity as IconActivity,
	Download as IconDownload,
	Layers as IconStack2,
	Server as IconServer,
	Boxes as IconBoxes,
	Users as IconUsers,
	Clock as IconClock,
} from "lucide-react";

const count = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const percent = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 1,
});

function cost(cents: number): string {
	return `$${(cents / 100).toFixed(cents > 0 && cents < 100 ? 4 : 2)}`;
}

function duration(ms: number | null): string {
	if (ms === null) {
		return "—";
	}
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Green only when the rate deserves it. A tile coloured for success at 80% teaches an operator to
 * stop reading the colour, so anything below 99% is stated in the neutral pill instead.
 */
function successTone(rate: number | null): StatusProps["tone"] {
	if (rate === null) {
		return "neutral";
	}
	if (rate >= 0.99) {
		return "success";
	}
	return rate >= 0.95 ? "warning" : "danger";
}

const usageColumns: Column<UsageRow>[] = [
	{
		key: "key",
		header: "Public model",
		render: (row) => <span className="font-medium">{row.key ?? "—"}</span>,
		compare: (a, b) => (a.key ?? "").localeCompare(b.key ?? ""),
	},
	{
		key: "requests",
		header: "Requests",
		align: "end",
		render: (row) => (
			<span className="tabular-nums">{count.format(row.requests)}</span>
		),
		compare: (a, b) => a.requests - b.requests,
	},
	{
		key: "tokens",
		header: "Total tokens",
		align: "end",
		render: (row) => (
			<div className="tabular-nums">
				<div>{count.format(row.totalTokens)}</div>
				<div className="mt-1 text-fg-muted text-xs">
					{count.format(row.promptTokens)} in ·{" "}
					{count.format(row.completionTokens)} out
				</div>
			</div>
		),
		compare: (a, b) => a.totalTokens - b.totalTokens,
	},
	...(
		[
			["cacheReadTokens", "Cached input"],
			["uncachedInputTokens", "Uncached input"],
			["cacheWriteTokens", "Cache writes"],
			["cacheUnreportedInputTokens", "Unclassified input"],
		] as const
	).map(
		([key, header]): Column<UsageRow> => ({
			key,
			header,
			align: "end",
			render: (row) => (
				<span className="tabular-nums">{tokenCount(row[key])}</span>
			),
			compare: (a, b) => (a[key] ?? -1) - (b[key] ?? -1),
		}),
	),
	{
		key: "cost",
		header: "Cost",
		align: "end",
		render: (row) => (
			<span className="tabular-nums">{cost(row.consumerCostCents)}</span>
		),
		compare: (a, b) => a.consumerCostCents - b.consumerCostCents,
	},
];

const actorColumns: Column<UsageRow>[] = [
	{
		key: "actor",
		header: "Actor",
		render: (row) => (row.key ? <Mono>{row.key}</Mono> : <Dash />),
		compare: (a, b) => (a.key ?? "").localeCompare(b.key ?? ""),
	},
	...usageColumns.slice(1),
];

/**
 * Postgres, Redis, the extension runtime and operation persistence, as the gateway itself reports
 * them. Usage numbers are drawn from the same database this row says is reachable — so when it is
 * not, the tables below are stale rather than empty, and an operator has to be told which.
 */
export function SystemStatus({ ready }: { ready: Readiness | null }) {
	if (!ready) {
		return (
			<Status tone="warning">
				<IconServer aria-hidden className="size-3.5" />
				health unreachable
			</Status>
		);
	}
	const healthy = ready.status === "ok";
	const failing = [
		ready.dependencies.database ? null : "database",
		ready.dependencies.cache ? null : "cache",
		ready.observability && !ready.observability.healthy ? "logging" : null,
		ready.extensions && !ready.extensions.healthy ? "extensions" : null,
	].filter(Boolean);
	return (
		<Status tone={healthy ? "success" : "danger"}>
			<IconServer aria-hidden className="size-3.5" />
			{healthy ? "all systems ready" : `degraded: ${failing.join(", ")}`}
		</Status>
	);
}

/** Spend by model or by actor is the number that ends up in someone else's spreadsheet. */
function UsageExport({ rows, name }: { rows: UsageRow[]; name: string }) {
	return (
		<Button
			aria-label={`Download ${name} as CSV`}
			disabled={rows.length === 0}
			onClick={() =>
				downloadCsv(
					`${name}-${new Date().toISOString().slice(0, 10)}.csv`,
					rows,
					[
						["key", (row) => row.key],
						["requests", (row) => row.requests],
						["promptTokens", (row) => row.promptTokens],
						["completionTokens", (row) => row.completionTokens],
						["totalTokens", (row) => row.totalTokens],
						["cacheReadTokens", (row) => row.cacheReadTokens ?? null],
						["cacheWriteTokens", (row) => row.cacheWriteTokens ?? null],
						["uncachedInputTokens", (row) => row.uncachedInputTokens ?? null],
						[
							"cacheUnreportedInputTokens",
							(row) => row.cacheUnreportedInputTokens ?? null,
						],
						["cacheReadReported", (row) => row.cacheReadReported ?? null],
						["cacheWriteReported", (row) => row.cacheWriteReported ?? null],
						["usageReported", (row) => row.usageReported ?? null],
						["consumerCostCents", (row) => row.consumerCostCents],
						["upstreamCostCents", (row) => row.upstreamCostCents],
					],
				)
			}
			size="sm"
			variant="ghost"
		>
			<IconDownload aria-hidden className="size-4" />
			CSV
		</Button>
	);
}

/**
 * A usage table under the heading that says what it counts, Billete's table section: the title,
 * description and export above, the framed table below.
 */
function UsageSection({
	title,
	description,
	rows,
	columns,
	caption,
	export: name,
	empty,
}: {
	title: string;
	description: string;
	rows: UsageRow[];
	columns: Column<UsageRow>[];
	caption: string;
	export: string;
	empty: { title: string; description: string; icon: LucideIcon };
}) {
	return (
		<Section
			action={<UsageExport name={name} rows={rows} />}
			description={description}
			title={title}
		>
			<DataTable
				caption={caption}
				columns={columns}
				emptyMessage={<EmptyState framed={false} {...empty} />}
				pagination={{ pageSize: 10 }}
				rowKey={(row) => row.key ?? "none"}
				rows={rows}
			/>
		</Section>
	);
}

/** "Today" reads as "By public model · today"; a custom range keeps its dates and "UTC". */
function inTitle(range: string): string {
	return range.charAt(0).toLowerCase() + range.slice(1);
}

export interface OverviewProps {
	health: Summary;
	byModel: UsageRow[];
	byActor: UsageRow[];
	/** Grouped by hour or by day, matching `bucket` — the range decides which. */
	byInterval: UsageRow[];
	start: string;
	end: string;
	bucket: UsageBucket;
	/** The range in words, for the table titles: "By public model · today". */
	rangeLabel: string;
}

/**
 * The body of the overview, and nothing else.
 *
 * The page header, the system-status badge, the refresh controls and the "Summary" heading with the
 * range control are rendered by the page around this component rather than inside it: they need
 * either no data or a different request, so keeping them out is what lets the page paint its chrome
 * before any of these numbers exist.
 */
export function Overview({
	health,
	byModel,
	byActor,
	byInterval,
	start,
	end,
	bucket,
	rangeLabel,
}: OverviewProps) {
	const metrics = getOverviewMetrics(health, byModel);
	const series = buildUsageSeries(byInterval, start, end, bucket);
	const modelCount = byModel.filter(
		(row) => row.key !== null && row.requests > 0,
	).length;
	const models = [...byModel].sort(
		(a, b) => b.consumerCostCents - a.consumerCostCents,
	);
	const actors = [...byActor].sort(
		(a, b) => b.consumerCostCents - a.consumerCostCents,
	);

	return (
		<div className="flex flex-col gap-6">
			<section
				aria-label="Usage summary"
				className="grid grid-cols-2 gap-3 lg:grid-cols-4"
			>
				<StatCard
					detail={`Across ${modelCount} public ${modelCount === 1 ? "model" : "models"}`}
					exact={count.format(metrics.requests)}
					icon={IconActivity}
					label="Requests"
					note={{
						text:
							metrics.successRate === null
								? "no outcomes"
								: `${percent.format(metrics.successRate)} success`,
						tone: successTone(metrics.successRate),
					}}
					value={compact.format(metrics.requests)}
				/>
				<StatCard
					detail={`${compact.format(metrics.promptTokens)} input tokens · includes cached input`}
					exact={count.format(metrics.totalTokens)}
					icon={IconStack2}
					label="Total tokens"
					note={{
						text: `${compact.format(metrics.completionTokens)} output`,
						exact: `${count.format(metrics.completionTokens)} output tokens`,
					}}
					value={compact.format(metrics.totalTokens)}
				/>
				<StatCard
					detail={`${cost(metrics.upstreamCostCents)} upstream cost`}
					icon={IconCurrencyDollar}
					label="Consumer cost"
					note={{
						text:
							metrics.requests > 0
								? `${cost(metrics.consumerCostCents / metrics.requests)}/req`
								: "no requests",
					}}
					value={cost(metrics.consumerCostCents)}
				/>
				<StatCard
					detail="Time to first generated output"
					icon={IconClock}
					label="First output · p95"
					note={{ text: `${count.format(metrics.retried)} retried` }}
					value={duration(metrics.p95FirstOutputMs)}
				/>
			</section>

			<div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<ActivityChart bucket={bucket} rows={series} updatedAt={end} />
				<div className="grid min-w-0 content-start gap-3">
					<RequestOutcomes metrics={metrics} />
					<Reliability metrics={metrics} />
				</div>
			</div>
			<CacheUsage
				records={metrics.requests}
				usage={aggregateCacheUsage(byModel)}
			/>
			<UsageSection
				caption="Usage by public model"
				columns={usageColumns}
				description="Total = input + output. Cached, uncached and unclassified counts split the reported input."
				empty={{
					icon: IconBoxes,
					title: "No usage in this period",
					description:
						"Requests, tokens and cost per public model appear here as traffic arrives.",
				}}
				export="usage-by-model"
				rows={models}
				title={`By public model · ${inTitle(rangeLabel)}`}
			/>
			<UsageSection
				caption="Usage by actor"
				columns={actorColumns}
				description="Includes operator traffic from the playground and manual tests."
				empty={{
					icon: IconUsers,
					title: "No usage in this period",
					description:
						"Requests, tokens and cost per API key or operator appear here as traffic arrives.",
				}}
				export="usage-by-actor"
				rows={actors}
				title={`By actor · ${inTitle(rangeLabel)}`}
			/>
		</div>
	);
}
