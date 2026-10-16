"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { type AuditFilters, isFiltered, PAGE_SIZE } from "./filters.ts";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { Pagination } from "#/shared/components/Pagination.tsx";
import { usePublishAuditRows } from "./AuditToolbar.tsx";
import { EmptyState } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import type { AuditEntry } from "./api.ts";
import { splitAction } from "./common.ts";

import {
	ShieldCheck as IconShieldCheck,
	SearchX as IconSearchX,
} from "lucide-react";

function statusTone(status: number | null) {
	if (status === null) {
		return "muted" as const;
	}
	if (status >= 500) {
		return "danger" as const;
	}
	if (status >= 400) {
		return "warning" as const;
	}
	return "success" as const;
}

const columns: Column<AuditEntry>[] = [
	{
		key: "at",
		header: "When",
		render: (row) => (
			// The operator's own timezone, which the server does not have.
			<span
				className="whitespace-nowrap text-fg-muted text-xs"
				suppressHydrationWarning
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
				<Status tone="warning">Payload read</Status>
			) : (
				<Status tone="muted">Config change</Status>
			),
	},
	{
		key: "status",
		header: "Result",
		render: (row) =>
			row.kind === "payload_access" ? (
				<Status tone={row.metadata.found ? "success" : "muted"}>
					{row.metadata.found ? "Sample returned" : "Nothing stored"}
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
	const { set, clear } = useSearchWriter(filters);
	usePublishAuditRows(rows);
	const filtered = isFiltered(filters);
	const offset = filters.offset ?? 0;

	const pagination = (
		<Pagination
			alwaysVisible
			label="entries"
			limit={PAGE_SIZE}
			offset={offset}
			onOffsetChange={(next) => set({ offset: next === 0 ? undefined : next })}
			total={total}
		/>
	);
	if (rows.length === 0) {
		let empty = (
			<EmptyState
				description="Every mutating admin call and every payload read lands here as it happens."
				icon={IconShieldCheck}
				title="Nothing recorded yet"
			/>
		);
		if (offset > 0) {
			empty = (
				<EmptyState
					description="Use Previous to return to earlier entries."
					icon={IconShieldCheck}
					title="No entries on this page"
				/>
			);
		} else if (filtered) {
			empty = (
				<EmptyState
					description="Reads are not audited — only changes and payload access — so a quiet trail can also mean nobody has changed anything."
					icon={IconSearchX}
					title="Nothing matches those filters"
				>
					<Button onClick={() => clear()} variant="secondary">
						Clear filters
					</Button>
				</EmptyState>
			);
		}
		return (
			<>
				{empty}
				{pagination}
			</>
		);
	}

	return (
		<>
			<DataTable
				caption="Audit trail"
				columns={columns}
				rowKey={(row) => row.id}
				rows={rows}
			/>
			{pagination}
		</>
	);
}
