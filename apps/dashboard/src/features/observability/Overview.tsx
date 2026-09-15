"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { buildUsageSeries, getOverviewMetrics } from "./overview-data";
import type { Readiness } from "#/shared/api/health.ts";
import { RequestOutcomes } from "./RequestOutcomes";
import type { UsageBucket } from "./overview-data";
import { downloadCsv } from "#/shared/lib/csv.ts";
import { ActivityChart } from "./ActivityChart";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import type { Summary, UsageRow } from "./api";
import { Card } from "#/components/ui/card";
import type { ReactNode } from "react";

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

function MetricCard({
	label,
	value,
	exact,
	icon: Icon,
	description,
	children,
}: {
	label: string;
	value: string;
	exact?: string;
	icon: typeof IconActivity;
	description: string;
	children: ReactNode;
}) {
	return (
		<Card className="flex min-w-0 flex-col p-5">
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-medium text-sm text-fg-muted">{label}</h2>
				<Icon
					aria-hidden
					className="size-4.5 shrink-0 text-fg-muted"
					stroke={1.6}
				/>
			</div>
			<p
				className="mt-4 text-3xl font-semibold tracking-tight tabular-nums"
				title={exact}
			>
				{value}
			</p>
			<p className="mt-1 text-xs text-fg-muted">{description}</p>
			<div className="mt-auto pt-5">
				<div className="flex min-h-9 items-center justify-between gap-3 border-t border-border/50 pt-3 text-xs tabular-nums">
					{children}
				</div>
			</div>
		</Card>
	);
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
				className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
			>
				<MetricCard
					label="Requests"
					value={compact.format(metrics.requests)}
					exact={count.format(metrics.requests)}
					icon={IconActivity}
					description={`Across ${modelCount} public ${modelCount === 1 ? "model" : "models"}`}
				>
					<span className="text-fg-muted">Successful outcomes</span>
					<span title="Share of finished requests" className="font-medium">
						{metrics.successRate === null
							? "—"
							: percent.format(metrics.successRate)}
					</span>
				</MetricCard>
				<MetricCard
					label="Tokens"
					value={compact.format(metrics.totalTokens)}
					exact={count.format(metrics.totalTokens)}
					icon={IconStack2}
					description="Reported usage across all models"
				>
					<span title={`${count.format(metrics.promptTokens)} input tokens`}>
						<span className="text-fg-muted">Input </span>
						<span className="font-medium">
							{compact.format(metrics.promptTokens)}
						</span>
					</span>
					<span
						title={`${count.format(metrics.completionTokens)} output tokens`}
					>
						<span className="text-fg-muted">Output </span>
						<span className="font-medium">
							{compact.format(metrics.completionTokens)}
						</span>
					</span>
				</MetricCard>
				<MetricCard
					label="Consumer cost"
					value={cost(metrics.consumerCostCents)}
					icon={IconCurrencyDollar}
					description={`${cost(metrics.upstreamCostCents)} upstream cost`}
				>
					<span className="text-fg-muted">Average / request</span>
					<span className="font-medium">
						{metrics.requests > 0
							? cost(metrics.consumerCostCents / metrics.requests)
							: "—"}
					</span>
				</MetricCard>
				<MetricCard
					label="First output · p95"
					value={duration(metrics.p95FirstOutputMs)}
					icon={IconClock}
					description="Time to first generated output"
				>
					<span className="text-fg-muted">Requests with retries</span>
					<span className="font-medium">{count.format(metrics.retried)}</span>
				</MetricCard>
			</section>

			<div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<ActivityChart rows={series} bucket={bucket} />
				<RequestOutcomes metrics={metrics} />
			</div>

			<div className="grid gap-x-4 gap-y-3 lg:grid-cols-2">
				<section
					aria-labelledby="models-heading"
					className="row-span-2 grid min-w-0 grid-rows-subgrid gap-3"
				>
					<div className="flex items-start justify-between gap-3 px-1">
						<div>
							<h2 id="models-heading" className="font-semibold">
								By public model
							</h2>
							<p className="mt-1 text-xs text-fg-muted">
								Request volume, token usage and consumer cost.
							</p>
						</div>
						<UsageExport rows={models} name="usage-by-model" />
					</div>
					<DataTable
						rows={models}
						columns={usageColumns}
						rowKey={(row) => row.key ?? "none"}
						caption="Usage by public model"
						pagination={{ pageSize: 10 }}
						className="self-start"
						emptyMessage={`No model usage in this range (${rangeLabel.toLowerCase()}).`}
					/>
				</section>
				<section
					aria-labelledby="actors-heading"
					className="row-span-2 grid min-w-0 grid-rows-subgrid gap-3"
				>
					<div className="flex items-start justify-between gap-3 px-1">
						<div>
							<h2 id="actors-heading" className="font-semibold">
								By actor
							</h2>
							<p className="mt-1 text-xs text-fg-muted">
								Includes operator traffic from the playground and manual tests.
							</p>
						</div>
						<UsageExport rows={actors} name="usage-by-actor" />
					</div>
					<DataTable
						rows={actors}
						columns={actorColumns}
						rowKey={(row) => row.key ?? "none"}
						caption="Usage by actor"
						pagination={{ pageSize: 10 }}
						className="self-start"
						emptyMessage={`No actor usage in this range (${rangeLabel.toLowerCase()}).`}
					/>
				</section>
			</div>
			<p className="px-1 text-xs text-fg-muted" role="status">
				Updated at {updatedTime.format(new Date(end))} UTC · Usage reflects
				recorded requests.
			</p>
		</div>
	);
}
