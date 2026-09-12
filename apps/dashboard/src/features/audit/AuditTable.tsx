"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { type AuditFilters, isFiltered, PAGE_SIZE } from "./filters.ts";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { Pagination } from "#/shared/components/Pagination.tsx";
import { IconDownload } from "@tabler/icons-react";
import { EmptyState } from "#/components/ui/page";
import { downloadCsv } from "#/shared/lib/csv.ts";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import type { AuditEntry } from "./api.ts";
import { splitAction } from "./common.ts";

function statusTone(status: number | null) {
	if (status === null) return "muted" as const;
	if (status >= 500) return "danger" as const;
	if (status >= 400) return "warning" as const;
	return "success" as const;
}

const columns: Column<AuditEntry>[] = [
	{
		key: "at",
		header: "When",
		render: (row) => (
			// The operator's own timezone, which the server does not have.
			<span
				suppressHydrationWarning
				className="whitespace-nowrap text-fg-muted text-xs"
			>
				{new Date(row.at).toLocaleString()}
			</span>
		),
	},
	{
		key: "actor",
		header: "Actor",
		render: (row) => <Mono>{row.actor}</Mono>,
	},
	{
		key: "action",
		header: "Action",
		render: (row) => {
			const { method, path } = splitAction(row.action);
			return (
				<div className="flex items-center gap-2">
					{method ? (
						<span className="font-semibold text-xs">{method}</span>
					) : null}
					<Mono>{path}</Mono>
				</div>
			);
		},
	},
	{
		key: "target",
		header: "Target",
		render: (row) =>
			row.targetType ? (
				<span className="text-xs">
					{row.targetType}
					{row.targetId ? (
						<span className="text-fg-muted"> · {row.targetId}</span>
					) : null}
				</span>
			) : (
				<Dash />
			),
	},
	{
		key: "kind",
		header: "Kind",
		render: (row) =>
			row.kind === "payload_access" ? (
				<Status tone="warning">payload read</Status>
			) : (
				<Status tone="muted">config</Status>
			),
	},
	{
		key: "status",
		header: "Result",
		render: (row) =>
			row.kind === "payload_access" ? (
				<Status tone={row.metadata.found ? "success" : "muted"}>
					{row.metadata.found ? "sample returned" : "nothing stored"}
				</Status>
			) : (
				<Status tone={statusTone(row.status)}>{row.status}</Status>
			),
	},
	{
		key: "ip",
		header: "IP",
		render: (row) =>
			row.ip ? (
				<span className="text-fg-muted text-xs">{row.ip}</span>
			) : (
				<Dash />
			),
	},
];

export function AuditTable({
	rows,
	total,
	filters,
}: {
	rows: AuditEntry[];
	total: number;
	filters: AuditFilters;
}) {
	const { set } = useSearchWriter(filters);
	const filtered = isFiltered(filters);
	const offset = filters.offset ?? 0;

	if (rows.length === 0)
		return (
			<EmptyState
				title={
					filtered ? "Nothing matches those filters" : "Nothing recorded yet"
				}
				description={
					filtered
						? "Reads are not audited — only changes and payload access — so a quiet trail can also mean nobody has changed anything."
						: "Every mutating admin call and every payload read lands here as it happens."
				}
			/>
		);

	return (
		<>
			<DataTable
				rows={rows}
				columns={columns}
				rowKey={(row) => row.id}
				caption="Audit trail"
				toolbar={
					<Button
						size="sm"
						variant="secondary"
						onClick={() =>
							downloadCsv(
								`audit-${new Date().toISOString().slice(0, 10)}.csv`,
								rows,
								[
									["at", (row) => row.at],
									["kind", (row) => row.kind],
									["actor", (row) => row.actor],
									["action", (row) => row.action],
									["targetType", (row) => row.targetType],
									["targetId", (row) => row.targetId],
									["status", (row) => row.status],
									["ip", (row) => row.ip],
									["requestId", (row) => row.requestId],
								],
							)
						}
					>
						<IconDownload size={15} aria-hidden className="mr-1" />
						CSV
					</Button>
				}
			/>
			<Pagination
				label="entries"
				limit={PAGE_SIZE}
				offset={offset}
				total={total}
				onOffsetChange={(next) =>
					set({ offset: next === 0 ? undefined : next })
				}
			/>
		</>
	);
}
