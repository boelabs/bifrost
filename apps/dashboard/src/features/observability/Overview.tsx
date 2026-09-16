"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { buildUsageSeries, getOverviewMetrics } from "./overview-data";
import { type StatusProps, Status } from "#/components/ui/status";
import { RequestOutcomes, Reliability } from "./RequestOutcomes";
import type { Readiness } from "#/shared/api/health.ts";
import type { UsageBucket } from "./overview-data";
import { downloadCsv } from "#/shared/lib/csv.ts";
import { ActivityChart } from "./ActivityChart";
import { Button } from "#/components/ui/button";
import type { Summary, UsageRow } from "./api";
import { Card } from "#/components/ui/card";
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
	if (ms === null) return "—";
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Green only when the rate deserves it. A tile coloured for success at 80% teaches an operator to
 * stop reading the colour, so anything below 99% is stated in the neutral pill instead.
 */
function successTone(rate: number | null): StatusProps["tone"] {
	if (rate === null) return "neutral";
	if (rate >= 0.99) return "success";
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
		header: "Tokens",
		align: "end",
		render: (row) => (
			<span className="tabular-nums">{count.format(row.totalTokens)}</span>
		),
		compare: (a, b) => a.totalTokens - b.totalTokens,
	},
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
		key: "cost",
		header: "Cost",
		align: "end",
		render: (row) => (
			<span className="tabular-nums">{cost(row.consumerCostCents)}</span>
		),
		compare: (a, b) => a.consumerCostCents - b.consumerCostCents,
	},
];

/**
 * Postgres, Redis, the extension runtime and operation persistence, as the gateway itself reports
 * them. Usage numbers are drawn from the same database this row says is reachable — so when it is
 * not, the tables below are stale rather than empty, and an operator has to be told which.
 */
export function SystemStatus({ ready }: { ready: Readiness | null }) {
	if (!ready)
		return (
			<Status tone="warning">
				<IconServer aria-hidden className="size-3.5" />
				health unreachable
			</Status>
		);
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
			size="sm"
			variant="ghost"
			disabled={rows.length === 0}
			aria-label={`Download ${name} as CSV`}
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
						["consumerCostCents", (row) => row.consumerCostCents],
						["upstreamCostCents", (row) => row.upstreamCostCents],
					],
				)
			}
		>
			<IconDownload size={15} aria-hidden className="mr-1" />
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
		<Card className="flex min-w-0 flex-col p-7" aria-labelledby={id}>
			<div className="flex items-start justify-between gap-3">
				<div>
					<h2 id={id} className="font-semibold">
						{title}
					</h2>
					<p className="mt-1 text-fg-muted text-xs">{description}</p>
				</div>
				<div className="-mt-1 -mr-2">
					<UsageExport rows={rows} name={name} />
				</div>
			</div>
			<DataTable
				rows={rows}
				columns={columns}
				rowKey={(row) => row.key ?? "none"}
				caption={caption}
				variant="plain"
				pagination={{ pageSize: 10 }}
				className="mt-5"
				emptyMessage={emptyMessage}
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
					label="Requests"
					value={compact.format(metrics.requests)}
					exact={count.format(metrics.requests)}
					icon={IconActivity}
					note={{
						text:
							metrics.successRate === null
								? "no outcomes"
								: `${percent.format(metrics.successRate)} success`,
						tone: successTone(metrics.successRate),
					}}
					detail={`Across ${modelCount} public ${modelCount === 1 ? "model" : "models"}`}
				/>
				<StatCard
					label="Tokens"
					value={compact.format(metrics.totalTokens)}
					exact={count.format(metrics.totalTokens)}
					icon={IconStack2}
					note={{
						text: `${compact.format(metrics.completionTokens)} output`,
						exact: `${count.format(metrics.completionTokens)} output tokens`,
					}}
					detail={`${compact.format(metrics.promptTokens)} input tokens reported`}
				/>
				<StatCard
					label="Consumer cost"
					value={cost(metrics.consumerCostCents)}
					icon={IconCurrencyDollar}
					note={{
						text:
							metrics.requests > 0
								? `${cost(metrics.consumerCostCents / metrics.requests)}/req`
								: "no requests",
					}}
					detail={`${cost(metrics.upstreamCostCents)} upstream cost`}
				/>
				<StatCard
					label="First output · p95"
					value={duration(metrics.p95FirstOutputMs)}
					icon={IconClock}
					note={{ text: `${count.format(metrics.retried)} retried` }}
					detail="Time to first generated output"
				/>
			</section>

			<div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<ActivityChart rows={series} bucket={bucket} />
				<div className="grid min-w-0 gap-5 content-start">
					<RequestOutcomes metrics={metrics} />
					<Reliability metrics={metrics} />
				</div>
			</div>

			<div className="grid items-start gap-5 xl:grid-cols-2">
				<UsagePanel
					id="models-heading"
					title="By public model"
					description="Request volume, token usage and consumer cost."
					rows={models}
					columns={usageColumns}
					caption="Usage by public model"
					export="usage-by-model"
					emptyMessage={`No model usage in this range (${rangeLabel.toLowerCase()}).`}
				/>
				<UsagePanel
					id="actors-heading"
					title="By actor"
					description="Includes operator traffic from the playground and manual tests."
					rows={actors}
					columns={actorColumns}
					caption="Usage by actor"
					export="usage-by-actor"
					emptyMessage={`No actor usage in this range (${rangeLabel.toLowerCase()}).`}
				/>
			</div>
			<p className="px-1 text-xs text-fg-muted" role="status">
				Updated at {updatedTime.format(new Date(end))} UTC · Usage reflects
				recorded requests.
			</p>
		</div>
	);
}
