"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { buildUsageSeries, getOverviewMetrics } from "./overview-data";
import { type StatusProps, Status } from "#/components/ui/status";
import { RequestOutcomes, Reliability } from "./RequestOutcomes";
import { aggregateCacheUsage, tokenCount } from "./cache-usage";
import type { Readiness } from "#/shared/api/health.ts";
import type { UsageBucket } from "./overview-data";
import { downloadCsv } from "#/shared/lib/csv.ts";
import { ActivityChart } from "./ActivityChart";
import { Button } from "#/components/ui/button";
import type { Summary, UsageRow } from "./api";
import { Card } from "#/components/ui/card";
import { CacheUsage } from "./CacheUsage";
import { StatCard } from "./StatCard";

import {
	IconCurrencyDollar,
	IconActivity,
	IconDownload,
	IconStack2,
	IconServer,
	IconClock,
} from "@tabler/icons-react";

const count = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const percent = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 1,
});
const updatedTime = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
	timeZone: "UTC",
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
			<IconDownload aria-hidden className="mr-1" size={15} />
			CSV
		</Button>
	);
}

/**
 * A usage table and the heading that says what it counts, in one surface.
 *
 * The heading sits inside the card rather than above it because the two are one statement: a title
 * floating on the page ground reads as a section containing a card, which is one box more than there
 * is. `variant="plain"` is what lets the table drop its own frame and use this one.
 */
function UsagePanel({
	id,
	title,
	description,
	rows,
	columns,
	caption,
	export: name,
	emptyMessage,
}: {
	id: string;
	title: string;
	description: string;
	rows: UsageRow[];
	columns: Column<UsageRow>[];
	caption: string;
	export: string;
	emptyMessage: string;
}) {
	return (
		<Card aria-labelledby={id} className="flex min-w-0 flex-col p-7">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h2 className="font-semibold" id={id}>
						{title}
					</h2>
					<p className="mt-1 text-fg-muted text-xs">{description}</p>
				</div>
				<div className="-mt-1 -mr-2">
					<UsageExport name={name} rows={rows} />
				</div>
			</div>
			<DataTable
				caption={caption}
				className="mt-5"
				columns={columns}
				emptyMessage={emptyMessage}
				pagination={{ pageSize: 10 }}
				rowKey={(row) => row.key ?? "none"}
				rows={rows}
				variant="plain"
			/>
		</Card>
	);
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
	/** The range in words, for the tables that have to say what "no usage" refers to. */
	rangeLabel: string;
}

/**
 * The body of the overview, and nothing else.
 *
 * The page header, the system-status badge and the refresh controls are rendered by the page around
 * this component rather than inside it: they need either no data or a different request, so keeping
 * them out is what lets the page paint its chrome before any of these numbers exist.
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
		<div className="space-y-6">
			<section
				aria-label="Usage summary"
				className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4"
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

			<div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<ActivityChart bucket={bucket} rows={series} />
				<div className="grid min-w-0 content-start gap-5">
					<RequestOutcomes metrics={metrics} />
					<Reliability metrics={metrics} />
				</div>
			</div>
			<CacheUsage
				records={metrics.requests}
				usage={aggregateCacheUsage(byModel)}
			/>
			<div className="grid items-start gap-5">
				<UsagePanel
					caption="Usage by public model"
					columns={usageColumns}
					description="Total = input + output. Cached, uncached and unclassified counts split the reported input."
					emptyMessage={`No model usage in this range (${rangeLabel.toLowerCase()}).`}
					export="usage-by-model"
					id="models-heading"
					rows={models}
					title="By public model"
				/>
				<UsagePanel
					caption="Usage by actor"
					columns={actorColumns}
					description="Includes operator traffic from the playground and manual tests."
					emptyMessage={`No actor usage in this range (${rangeLabel.toLowerCase()}).`}
					export="usage-by-actor"
					id="actors-heading"
					rows={actors}
					title="By actor"
				/>
			</div>
			<p className="px-1 text-fg-muted text-xs" role="status">
				Updated at {updatedTime.format(new Date(end))} UTC · Usage reflects
				recorded requests.
			</p>
		</div>
	);
}
