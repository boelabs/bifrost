"use client";

import { SearchableSelect, Select, SelectItem } from "#/components/ui/select";
import { type Column, DataTable } from "#/components/ui/datatable";
import { cacheReuseRate, tokenCount } from "./cache-usage";
import { EmptyState } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { MetricsChart } from "./MetricsChart";
import { Input } from "#/components/ui/input";
import type { DetailedMetrics } from "./api";
import { Card } from "#/components/ui/card";
import { CacheUsage } from "./CacheUsage";
import { StatCard } from "./StatCard";
import { useState } from "react";

import {
	type MetricsSearch,
	reportedTokens,
	duration,
	compact,
	count,
	money,
	rate,
} from "./metrics-data";

type Deployment = DetailedMetrics["deployments"][number];
type Model = DetailedMetrics["models"][number];
type Failure = DetailedMetrics["failures"][number];

const operations = [
	["text.generate", "Text generation"],
	["image.generate", "Image generation"],
	["image.edit", "Image editing"],
	["embedding.create", "Embeddings"],
	["audio.transcribe", "Audio transcription"],
	["video.generate", "Video generation"],
	["rerank", "Reranking"],
] as const;

function Breakdown({ data }: { data: DetailedMetrics }) {
	const requests = data.requests;
	const outcomes = [
		{ label: "Success", value: requests.success, color: "bg-chart-2" },
		{ label: "Error", value: requests.errors, color: "bg-danger" },
		{ label: "Incomplete", value: requests.incomplete, color: "bg-chart-3" },
		{ label: "Blocked", value: requests.blocked, color: "bg-chart-3" },
		{ label: "Cancelled", value: requests.cancelled, color: "bg-chart-4" },
		{
			label: "Abandoned / unknown",
			value: requests.abandoned + requests.unknown,
			color: "bg-chart-5",
		},
		{
			label: "In progress",
			value: requests.requests - requests.finished,
			color: "bg-chart-1",
		},
	];
	const tokens = data.attempts;
	return (
		<div className="grid gap-5 lg:grid-cols-2">
			<Card className="p-7">
				<h2 className="font-semibold">Request outcomes</h2>
				<p className="mt-1 text-xs text-fg-muted">
					Final result after all attempts. In-progress requests are excluded
					from rates.
				</p>
				<div className="mt-5 space-y-3">
					{outcomes.map((row) => (
						<div
							key={row.label}
							className="grid grid-cols-[9rem_1fr_3.5rem] items-center gap-3 text-xs"
						>
							<span>{row.label}</span>
							<div className="h-1.5 overflow-hidden rounded-full bg-secondary">
								<div
									className={`h-full rounded-full ${row.color}`}
									style={{
										width: `${requests.requests ? (row.value / requests.requests) * 100 : 0}%`,
									}}
								/>
							</div>
							<span className="text-right tabular-nums">
								{count.format(row.value)}
							</span>
						</div>
					))}
				</div>
			</Card>
			<Card className="p-7">
				<h2 className="font-semibold">Deployment token breakdown</h2>
				<p className="mt-1 text-xs text-fg-muted">
					Reported upstream usage, including retries. Reasoning and cache are
					subsets, not additional totals.
				</p>
				<dl className="mt-4 divide-y divide-border/50 text-sm">
					{(
						[
							["Input", tokens.promptTokens],
							["Output", tokens.completionTokens],
							["Reasoning", tokens.reasoningTokens],
							["Cache read", tokens.cacheReadTokens],
							["Cache write", tokens.cacheWriteTokens],
							["Search units", tokens.searchUnits],
						] as const
					).map(([label, value]) => (
						<div key={label} className="flex justify-between gap-3 py-2">
							<dt className="text-fg-muted">{label}</dt>
							<dd className="tabular-nums">
								{value === null ? "—" : count.format(value)}
							</dd>
						</div>
					))}
				</dl>
				<p className="mt-3 text-xs text-fg-muted">
					Token totals reported by {count.format(tokens.usageReported)} of{" "}
					{count.format(tokens.attempts)} attempts. Unreported usage is not
					estimated.
				</p>
			</Card>
		</div>
	);
}

export function Metrics({
	data,
	options,
	search,
	refreshing,
	onChange,
}: {
	data: DetailedMetrics;
	options: Pick<DetailedMetrics, "models" | "deployments">;
	search: MetricsSearch;
	/** Covers a filter navigation as well as a refresh: both replace what is on screen. */
	refreshing: boolean;
	onChange: (patch: Partial<MetricsSearch>) => void;
}) {
	const [from, setFrom] = useState(search.from ?? data.start.slice(0, 10));
	const [to, setTo] = useState(search.to ?? data.end.slice(0, 10));
	const rangeValid =
		from &&
		to &&
		from <= to &&
		Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) <
			31 * 86_400_000 &&
		to <= new Date().toISOString().slice(0, 10);
	const requests = data.requests;
	const attempts = data.attempts;
	const modelOptions = options.models.flatMap((row) =>
		row.key ? [{ value: row.key, label: row.key }] : [],
	);
	if (
		search.publicModel &&
		!modelOptions.some((row) => row.value === search.publicModel)
	)
		modelOptions.push({ value: search.publicModel, label: search.publicModel });
	const deploymentOptions = options.deployments.flatMap((row) =>
		row.key
			? [
					{
						value: row.key,
						label: `${row.label ?? row.key.slice(0, 8)} · ${row.adapter ?? "unknown adapter"} · ${row.key.slice(0, 8)}`,
					},
				]
			: [],
	);
	if (
		search.deploymentId &&
		!deploymentOptions.some((row) => row.value === search.deploymentId)
	)
		deploymentOptions.push({
			value: search.deploymentId,
			label: search.deploymentId,
		});
	const deployments: Column<Deployment>[] = [
		{
			key: "label",
			header: "Deployment",
			render: (row) => (
				<div>
					<Button
						variant="link"
						size="sm"
						title={row.key ?? undefined}
						disabled={!row.key}
						onClick={() => onChange({ deploymentId: row.key ?? undefined })}
					>
						{row.label ?? row.key?.slice(0, 8) ?? "Unattributed"}
					</Button>
					<p className="mt-0.5 text-xs text-fg-muted">
						{row.adapter ?? "Unknown adapter"} ·{" "}
						{row.key?.slice(0, 8) ?? "No deployment"}
					</p>
				</div>
			),
			compare: (a, b) => (a.label ?? "").localeCompare(b.label ?? ""),
		},
		{
			key: "attempts",
			header: "Attempts",
			align: "end",
			render: (row) => count.format(row.attempts),
			compare: (a, b) => a.attempts - b.attempts,
		},
		{
			key: "tokens",
			header: "Reported tokens",
			align: "end",
			render: (row) => (
				<span
					title={`${row.usageReported} of ${row.attempts} attempts reported tokens`}
				>
					{reportedTokens(row)}
				</span>
			),
			compare: (a, b) => a.totalTokens - b.totalTokens,
		},
		{
			key: "cache",
			header: "Cached input",
			align: "end",
			render: (row) => (
				<div className="tabular-nums">
					<div>{tokenCount(row.cacheReadTokens)}</div>
					<div className="mt-1 text-xs text-fg-muted">
						{cacheReuseRate(row) === null
							? "—"
							: rate(
									row.cacheReadTokens ?? 0,
									(row.cacheReadTokens ?? 0) + (row.uncachedInputTokens ?? 0),
								)}{" "}
						reuse · {tokenCount(row.cacheReadReported)}/{row.attempts} reported
					</div>
				</div>
			),
			compare: (a, b) => (a.cacheReadTokens ?? -1) - (b.cacheReadTokens ?? -1),
		},
		{
			key: "errors",
			header: "Errors",
			align: "end",
			render: (row) => (
				<span className={row.errors ? "text-danger" : ""}>
					{count.format(row.errors)}
				</span>
			),
			compare: (a, b) => a.errors - b.errors,
		},
		{
			key: "rate",
			header: "Error rate",
			align: "end",
			render: (row) => rate(row.errors, row.finished),
			compare: (a, b) =>
				a.errors / (a.finished || 1) - b.errors / (b.finished || 1),
		},
		{
			key: "latency",
			header: "Latency p95",
			align: "end",
			render: (row) => duration(row.p95DurationMs),
			compare: (a, b) => (a.p95DurationMs ?? -1) - (b.p95DurationMs ?? -1),
		},
	];
	const models: Column<Model>[] = [
		{
			key: "model",
			header: "Public model",
			render: (row) => (
				<Button
					variant="link"
					size="sm"
					disabled={!row.key}
					onClick={() =>
						onChange({
							publicModel: row.key ?? undefined,
							deploymentId: undefined,
						})
					}
				>
					{row.key ?? "Unattributed"}
				</Button>
			),
			compare: (a, b) => (a.key ?? "").localeCompare(b.key ?? ""),
		},
		{
			key: "requests",
			header: "Requests",
			align: "end",
			render: (row) => count.format(row.requests),
			compare: (a, b) => a.requests - b.requests,
		},
		{
			key: "tokens",
			header: "Request tokens",
			align: "end",
			render: (row) => reportedTokens(row),
			compare: (a, b) => a.totalTokens - b.totalTokens,
		},
		{
			key: "errors",
			header: "Errors",
			align: "end",
			render: (row) => count.format(row.errors),
			compare: (a, b) => a.errors - b.errors,
		},
		{
			key: "cost",
			header: "Consumer cost",
			align: "end",
			render: (row) => money(row.consumerCostCents),
			compare: (a, b) => a.consumerCostCents - b.consumerCostCents,
		},
		{
			key: "latency",
			header: "Latency p95",
			align: "end",
			render: (row) => duration(row.p95DurationMs),
			compare: (a, b) => (a.p95DurationMs ?? -1) - (b.p95DurationMs ?? -1),
		},
	];
	const failures: Column<Failure>[] = [
		{
			key: "deployment",
			header: "Deployment",
			render: (row) => (
				<span title={row.deploymentId ?? undefined}>
					{row.label ?? row.deploymentId?.slice(0, 8) ?? "Unattributed"}
				</span>
			),
		},
		{
			key: "kind",
			header: "Failure",
			render: (row) => row.kind ?? "Unclassified",
		},
		{ key: "phase", header: "Phase", render: (row) => row.phase ?? "—" },
		{
			key: "status",
			header: "Provider status",
			render: (row) => row.status ?? "—",
		},
		{
			key: "count",
			header: "Errors",
			align: "end",
			render: (row) => count.format(row.count),
			compare: (a, b) => a.count - b.count,
		},
	];
	return (
		<div className="space-y-6" aria-busy={refreshing}>
			<Card className="p-5">
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<Select
						label="Period · UTC"
						size="sm"
						value={search.period}
						onValueChange={(period) => {
							if (period)
								onChange({
									period: period as MetricsSearch["period"],
									...(period === "custom" ? { from, to } : {}),
								});
						}}
					>
						{[
							["today", "Today"],
							["yesterday", "Yesterday"],
							["7d", "Last 7 days"],
							["30d", "Last 30 days"],
							["custom", "Custom dates"],
						].map(([value, label]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</Select>
					<Select
						label="Operation"
						size="sm"
						value={search.operation ?? "all"}
						onValueChange={(value) =>
							onChange({
								operation:
									value === "all"
										? undefined
										: (value as MetricsSearch["operation"]),
								publicModel: undefined,
								deploymentId: undefined,
							})
						}
					>
						<SelectItem value="all">All operations</SelectItem>
						{operations.map(([value, label]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</Select>
					<SearchableSelect
						label="Public model"
						size="sm"
						items={modelOptions}
						value={search.publicModel ?? null}
						onValueChange={(value) =>
							onChange({
								publicModel: value ?? undefined,
								deploymentId: undefined,
							})
						}
						searchPlaceholder="All public models"
					/>
					<SearchableSelect
						label="Deployment"
						size="sm"
						items={deploymentOptions}
						value={search.deploymentId ?? null}
						onValueChange={(value) =>
							onChange({ deploymentId: value ?? undefined })
						}
						searchPlaceholder="All deployments"
					/>
				</div>
				{search.period === "custom" && (
					<form
						className="mt-4 flex flex-wrap items-end gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (rangeValid) onChange({ from, to });
						}}
					>
						<Input
							label="From (UTC)"
							type="date"
							size="sm"
							value={from}
							onChange={(event) => setFrom(event.target.value)}
							required
						/>
						<Input
							label="Through (UTC)"
							type="date"
							size="sm"
							value={to}
							onChange={(event) => setTo(event.target.value)}
							required
						/>
						<Button
							type="submit"
							variant="secondary"
							size="sm"
							disabled={!rangeValid || refreshing}
						>
							Apply dates
						</Button>
						<p className="pb-2 text-xs text-fg-muted">
							Up to 31 days. End date is included.
						</p>
					</form>
				)}
				{(search.publicModel || search.deploymentId || search.operation) && (
					<Button
						className="mt-3"
						variant="link"
						size="sm"
						onClick={() =>
							onChange({
								publicModel: undefined,
								deploymentId: undefined,
								operation: undefined,
							})
						}
					>
						Clear model, deployment and operation filters
					</Button>
				)}
				<p className="mt-3 text-xs text-fg-muted">
					{new Date(data.start).toLocaleString("en-US", { timeZone: "UTC" })} –{" "}
					{new Date(data.end).toLocaleString("en-US", { timeZone: "UTC" })} UTC
				</p>
			</Card>
			{search.deploymentId && (
				<p className="rounded-lg border border-border bg-secondary/40 p-3 text-sm text-fg-muted">
					Request metrics cover requests that used this deployment, including
					any fallback. Deployment tokens and errors cover only its own
					attempts.
				</p>
			)}
			<section
				aria-label="Metrics summary"
				className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
			>
				<StatCard
					label="Deployment tokens"
					value={reportedTokens(attempts, true)}
					exact={reportedTokens(attempts)}
					detail={`${count.format(attempts.usageReported)} / ${count.format(attempts.attempts)} attempts reported usage · includes retries`}
				/>
				<StatCard
					label="Requests"
					value={compact.format(requests.requests)}
					exact={count.format(requests.requests)}
					detail={`${rate(requests.success, requests.finished)} successful · ${count.format(requests.requests - requests.finished)} in progress`}
				/>
				<StatCard
					label="Consumer cost"
					value={money(requests.consumerCostCents)}
					detail={`${money(requests.upstreamCostCents)} recorded upstream cost · selected requests`}
				/>
				<StatCard
					label="Deployment errors"
					value={count.format(attempts.errors)}
					detail={`${rate(attempts.errors, attempts.finished)} of finished attempts · ${count.format(requests.errors)} final request errors`}
				/>
				<StatCard
					label="Request latency · p95"
					value={duration(requests.p95DurationMs)}
					detail={`${duration(requests.p50DurationMs)} median · ${duration(requests.p95FirstOutputMs)} first output p95 (streamed)`}
				/>
				<StatCard
					label="Request tokens"
					value={reportedTokens(requests, true)}
					exact={reportedTokens(requests)}
					detail={`${count.format(requests.cacheHits)} response-cache hits · ${count.format(requests.degraded)} degraded requests`}
				/>
			</section>
			{requests.requests === 0 ? (
				<EmptyState
					title="No activity in this period"
					description="Change the dates or clear filters. Metrics appear after the gateway records traffic."
				/>
			) : (
				<>
					<div className="grid gap-4 xl:grid-cols-2">
						<MetricsChart data={data} />
						<MetricsChart data={data} upstream />
					</div>
					<CacheUsage usage={attempts} records={attempts.attempts} upstream />
					<Breakdown data={data} />
					<section className="space-y-3">
						<div>
							<h2 className="font-semibold">By deployment</h2>
							<p className="mt-1 text-xs text-fg-muted">
								An executable route to a provider. Select one to inspect its
								consumption and failures. Error rates use finished attempts.
							</p>
						</div>
						<DataTable
							rows={[...data.deployments].sort(
								(a, b) => b.totalTokens - a.totalTokens,
							)}
							columns={deployments}
							rowKey={(row) => row.key ?? "none"}
							caption="Deployment metrics"
							search={{
								getText: (row) => `${row.label} ${row.adapter} ${row.key}`,
								placeholder: "Search deployments…",
							}}
							pagination={{ pageSize: 10 }}
							emptyMessage="No upstream attempts. Requests may have been cached or rejected before routing."
						/>
					</section>
					<section className="space-y-3">
						<div>
							<h2 className="font-semibold">By public model</h2>
							<p className="mt-1 text-xs text-fg-muted">
								The model name clients request. Each request is counted once,
								even if it required several attempts.
							</p>
						</div>
						<DataTable
							rows={data.models}
							columns={models}
							rowKey={(row) => row.key ?? "none"}
							caption="Public model metrics"
							search={{
								getText: (row) => row.key ?? "",
								placeholder: "Search public models…",
							}}
							pagination={{ pageSize: 10 }}
						/>
					</section>
					<section className="space-y-3">
						<div>
							<h2 className="font-semibold">Deployment failures</h2>
							<p className="mt-1 text-xs text-fg-muted">
								Failed attempts, including failures recovered by retries or
								fallback.
							</p>
						</div>
						<DataTable
							rows={[...data.failures].sort((a, b) => b.count - a.count)}
							columns={failures}
							rowKey={(row) =>
								JSON.stringify([
									row.deploymentId,
									row.kind,
									row.phase,
									row.status,
								])
							}
							caption="Deployment failure breakdown"
							pagination={{ pageSize: 10 }}
							emptyMessage="No deployment errors recorded in this period."
						/>
					</section>
				</>
			)}
			<p role="status" className="text-xs text-fg-muted">
				Based on retained records, grouped by request start in UTC. Deleted
				deployments remain visible while their history is retained. Refresh to
				include new traffic and completed requests.
			</p>
		</div>
	);
}
