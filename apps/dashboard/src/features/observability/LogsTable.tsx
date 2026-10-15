"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { Pagination } from "#/shared/components/Pagination.tsx";
import { Status, outcomeTone } from "#/components/ui/status";
import { causeLabel, formatDuration } from "./trace.ts";
import { Download as IconDownload } from "lucide-react";
import { EmptyState } from "#/components/ui/page";
import { downloadCsv } from "#/shared/lib/csv.ts";
import { Button } from "#/components/ui/button";
import type { OperationRow } from "./api.ts";

import {
	type LogsFilters,
	DEFAULT_PERIOD,
	isFiltered,
	PAGE_SIZE,
} from "./logFilters.ts";

function errorCode(row: OperationRow): string | null {
	const { error } = row as {
		error?: { code?: unknown; class?: unknown } | null;
	};
	const code = error?.code ?? error?.class;
	return typeof code === "string" ? code.replaceAll("_", " ") : null;
}

/** Why a request failed, or what a recovered one survived. */
function CauseCell({ row }: { row: OperationRow }) {
	if (row.lastFailure) {
		const recovered = row.outcome === "success";
		return (
			<span
				className={recovered ? "text-fg-muted text-xs" : "text-xs"}
				title={recovered ? "Recovered by a retry or fallback" : undefined}
			>
				{causeLabel(row.lastFailure)}
				{recovered ? " · recovered" : ""}
			</span>
		);
	}
	// No attempt failed: the request may have ended at the gateway (an unknown model, a limit),
	// and its own error code is the cause.
	const code = row.outcome === "success" ? null : errorCode(row);
	return code ? <span className="text-xs">Gateway · {code}</span> : <Dash />;
}

function relative(iso: string): string {
	const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
	if (seconds < 60) {
		return `${seconds}s ago`;
	}
	if (seconds < 3600) {
		return `${Math.round(seconds / 60)}m ago`;
	}
	if (seconds < 86_400) {
		return `${Math.round(seconds / 3600)}h ago`;
	}
	return new Date(iso).toLocaleDateString();
}

export function LogsTable({
	rows,
	total,
	filters,
}: {
	rows: OperationRow[];
	total: number;
	filters: LogsFilters;
}) {
	const { set } = useSearchWriter(filters);
	const filtered = isFiltered(filters);
	// When the window is already "Everything", widening it is not the advice to give.
	const everything = (filters.period ?? DEFAULT_PERIOD) === "all";
	const offset = filters.offset ?? 0;

	const columns: Column<OperationRow>[] = [
		{
			key: "time",
			header: "Time",
			render: (row) => (
				// The row's link (`rowHref`): every row opens its operation's page, and the list's
				// filters stay in the URL Back returns to.
				<>
					<span className="sr-only">Open operation started </span>
					{/*
					 * Rendered from the operator's own clock and timezone, which the server does not
					 * have: the markup it streamed is expected to differ from what hydration produces.
					 */}
					<span
						className="whitespace-nowrap text-fg-muted text-xs"
						suppressHydrationWarning
						title={new Date(row.startedAt).toLocaleString()}
					>
						{relative(row.startedAt)}
					</span>
				</>
			),
		},
		{
			key: "outcome",
			header: "Outcome",
			render: (row) => (
				<Status tone={outcomeTone(row.outcome)}>
					{row.outcome ?? row.lifecycleState}
				</Status>
			),
		},
		{
			key: "model",
			header: "Public model",
			render: (row) =>
				row.publicModel ? (
					<div className="flex min-w-0 flex-col">
						<span className="truncate font-medium">{row.publicModel}</span>
						<span className="truncate text-fg-muted text-xs">
							{row.callType}
							{row.servedBy ? ` · ${row.servedBy}` : ""}
						</span>
					</div>
				) : (
					<Dash />
				),
		},
		{
			key: "status",
			header: "Status",
			render: (row) => (
				<div className="flex items-center gap-1.5">
					{row.httpStatus === null ? <Dash /> : <Mono>{row.httpStatus}</Mono>}
					{row.stream ? <Status tone="muted">stream</Status> : null}
					{row.cacheHit ? <Status tone="success">cached</Status> : null}
				</div>
			),
		},
		{
			key: "cause",
			header: "Cause",
			render: (row) => <CauseCell row={row} />,
		},
		{
			key: "attempts",
			header: "Attempts",
			align: "end",
			render: (row) => (
				<span
					className={
						row.attemptCount > 1
							? "font-medium text-warning-foreground tabular-nums"
							: "tabular-nums"
					}
				>
					{row.attemptCount}
				</span>
			),
		},
		{
			key: "firstOutput",
			header: "First output",
			align: "end",
			render: (row) =>
				row.firstOutputMs === null ? (
					<Dash />
				) : (
					<span className="tabular-nums">
						{formatDuration(row.firstOutputMs)}
					</span>
				),
		},
		{
			key: "duration",
			header: "Duration",
			align: "end",
			render: (row) => (
				<span className="whitespace-nowrap tabular-nums">
					{formatDuration(row.durationMs)}
				</span>
			),
		},
		{
			key: "tokens",
			header: "Tokens",
			align: "end",
			render: (row) =>
				row.totalTokens === null ? (
					<Dash />
				) : (
					<span className="tabular-nums">
						{row.totalTokens.toLocaleString()}
					</span>
				),
		},
	];

	return rows.length === 0 ? (
		<EmptyState
			description={
				filtered || !everything
					? "Widen the time range or clear the filters — traffic older than the window is not shown."
					: "Traffic through /v1 appears here within seconds."
			}
			title="No operations match"
		/>
	) : (
		<>
			<DataTable
				caption="Gateway operations"
				columns={columns}
				rowHref={(row) => `/logs/${row.id}`}
				rowKey={(row) => row.id}
				rows={rows}
				toolbar={
					<Button
						onClick={() =>
							downloadCsv(
								`operations-${new Date().toISOString().slice(0, 10)}.csv`,
								rows,
								[
									["id", (row) => row.id],
									["requestId", (row) => row.requestId],
									["startedAt", (row) => row.startedAt],
									["outcome", (row) => row.outcome ?? row.lifecycleState],
									["httpStatus", (row) => row.httpStatus],
									["publicModel", (row) => row.publicModel],
									["callType", (row) => row.callType],
									["servedBy", (row) => row.servedBy],
									["actor", (row) => row.actor],
									["attempts", (row) => row.attemptCount],
									[
										"cause",
										(row) =>
											row.lastFailure ? causeLabel(row.lastFailure) : null,
									],
									["firstOutputMs", (row) => row.firstOutputMs],
									["durationMs", (row) => row.durationMs],
									["totalTokens", (row) => row.totalTokens],
									["stream", (row) => row.stream],
									["cacheHit", (row) => row.cacheHit],
								],
							)
						}
						variant="secondary"
					>
						<IconDownload aria-hidden className="size-4" />
						CSV
					</Button>
				}
			/>
			<Pagination
				label="operations"
				limit={PAGE_SIZE}
				offset={offset}
				onOffsetChange={(next) =>
					set({ offset: next === 0 ? undefined : next })
				}
				total={total}
			/>
		</>
	);
}
