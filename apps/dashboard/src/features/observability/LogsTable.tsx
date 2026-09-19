"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { Pagination } from "#/shared/components/Pagination.tsx";
import { IconDownload, IconSearch } from "@tabler/icons-react";
import { Status, outcomeTone } from "#/components/ui/status";
import { EmptyState } from "#/components/ui/page";
import { downloadCsv } from "#/shared/lib/csv.ts";
import { Button } from "#/components/ui/button";
import type { OperationRow } from "./api.ts";
import { LogDetail } from "./LogDetail.tsx";
import { useState } from "react";

import {
	type LogsFilters,
	DEFAULT_PERIOD,
	isFiltered,
	PAGE_SIZE,
} from "./logFilters.ts";

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
	const [inspecting, setInspecting] = useState<string | null>(null);
	const filtered = isFiltered(filters);
	// When the window is already "Everything", widening it is not the advice to give.
	const everything = (filters.period ?? DEFAULT_PERIOD) === "all";
	const offset = filters.offset ?? 0;

	const columns: Column<OperationRow>[] = [
		{
			key: "time",
			header: "Time",
			render: (row) => (
				// Rendered from the operator's own clock and timezone, which the server does not have:
				// the markup it streamed is expected to differ from what hydration produces here.
				<span
					className="whitespace-nowrap text-fg-muted text-xs"
					suppressHydrationWarning
					title={new Date(row.startedAt).toLocaleString()}
				>
					{relative(row.startedAt)}
				</span>
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
					<span className="font-medium">{row.publicModel}</span>
				) : (
					<Dash />
				),
		},
		{
			key: "callType",
			header: "Call",
			render: (row) => <Mono>{row.callType}</Mono>,
		},
		{
			key: "actor",
			header: "Actor",
			render: (row) => (row.actor ? <Mono>{row.actor}</Mono> : <Dash />),
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
		{
			key: "duration",
			header: "Duration",
			align: "end",
			render: (row) =>
				row.durationMs === null ? (
					<Dash />
				) : (
					<span className="tabular-nums">{row.durationMs} ms</span>
				),
		},
		{
			key: "flags",
			header: "",
			align: "end",
			render: (row) => (
				<div className="flex justify-end gap-1.5">
					{row.stream ? <Status tone="muted">stream</Status> : null}
					{row.cacheHit ? <Status tone="success">cached</Status> : null}
					{row.degraded ? <Status tone="warning">degraded</Status> : null}
				</div>
			),
		},
		{
			key: "inspect",
			header: "",
			align: "end",
			render: (row) => (
				<Button
					aria-label={`Inspect operation ${row.id}`}
					mode="icon"
					onClick={() => setInspecting(row.id)}
					size="sm"
					variant="ghost"
				>
					<IconSearch aria-hidden size={15} />
				</Button>
			),
		},
	];

	return (
		<>
			{rows.length === 0 ? (
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
											["startedAt", (row) => row.startedAt],
											["outcome", (row) => row.outcome ?? row.lifecycleState],
											["publicModel", (row) => row.publicModel],
											["callType", (row) => row.callType],
											["actor", (row) => row.actor],
											["totalTokens", (row) => row.totalTokens],
											["durationMs", (row) => row.durationMs],
											["cacheHit", (row) => row.cacheHit],
											["degraded", (row) => row.degraded],
										],
									)
								}
								size="sm"
								variant="secondary"
							>
								<IconDownload aria-hidden className="mr-1" size={15} />
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
			)}

			<LogDetail onClose={() => setInspecting(null)} operationId={inspecting} />
		</>
	);
}
