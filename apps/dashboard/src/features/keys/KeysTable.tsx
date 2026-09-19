"use client";

import { IconBan, IconCheck, IconPencil, IconTrash } from "@tabler/icons-react";
import { type Column, DataTable, Dash } from "#/components/ui/datatable";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { Pagination } from "#/shared/components/Pagination.tsx";
import { deleteKeyAction, updateKeyAction } from "./actions.ts";
import { RowActions } from "#/shared/components/RowActions.tsx";
import { formatCents, type VirtualKey } from "./common.ts";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { type KeysFilters, PAGE_SIZE } from "./filters.ts";
import { useRowActions } from "#/shared/lib/mutation.ts";
import { useSession } from "#/features/auth/session.tsx";
import { EmptyState } from "#/components/ui/page";
import { Status } from "#/components/ui/status";
import { useKeys } from "./KeysView.tsx";

/**
 * A key whose budget is gone stops working, and the first anyone hears about it is a client's 429.
 * The row says so beforehand, which is the whole point of storing a budget at all.
 */
function budgetWarning(key: VirtualKey) {
	if (key.maxBudgetCents === null || key.maxBudgetCents === 0) {
		return null;
	}
	const spent = Number.parseFloat(key.spendCents);
	if (!Number.isFinite(spent)) {
		return null;
	}
	const share = spent / key.maxBudgetCents;
	if (share >= 1) {
		return <Status tone="danger">budget spent</Status>;
	}
	if (share >= 0.9) {
		return <Status tone="warning">{Math.round(share * 100)}% of budget</Status>;
	}
	return null;
}

export function KeysTable({
	keys: loaded,
	total,
	filters,
}: {
	keys: VirtualKey[];
	total: number;
	filters: KeysFilters;
}) {
	const { set } = useSearchWriter(filters);
	const { can } = useSession();
	const { edit } = useKeys();
	const confirm = useConfirm();
	const { rows: keys, act } = useRowActions(loaded, (key) => key.id);
	const searched = Boolean(filters.q);
	const offset = filters.offset ?? 0;
	const writable = can("keys:write");

	async function remove(key: VirtualKey) {
		const confirmed = await confirm({
			title: `Delete ${key.name}?`,
			description:
				"Any client still sending this key starts failing immediately, and the secret cannot be restored — a replacement is a new key.",
			confirmLabel: "Delete key",
		});
		if (!confirmed) {
			return;
		}
		await act(key.id, {
			optimistic: "removed",
			action: () => deleteKeyAction(key.id),
			success: `${key.name} deleted`,
			failure: "The key could not be deleted.",
		});
	}

	async function toggle(key: VirtualKey) {
		await act(key.id, {
			optimistic: { enabled: !key.enabled },
			action: () => updateKeyAction(key.id, { enabled: !key.enabled }),
			success: `${key.name} ${key.enabled ? "disabled" : "enabled"}`,
			failure: "The key could not be updated.",
		});
	}

	const columns: Column<VirtualKey>[] = [
		{
			key: "name",
			header: "Name",
			render: (key) => <span className="font-medium">{key.name}</span>,
		},
		{
			key: "models",
			header: "Models",
			render: (key) =>
				key.allowedModels.length === 0 ? (
					<span className="text-fg-muted">all</span>
				) : (
					key.allowedModels.join(", ")
				),
		},
		{
			key: "spend",
			header: "Spend",
			render: (key) => (
				<div className="flex flex-wrap items-center gap-2">
					<span>
						{formatCents(key.spendCents)}
						{key.maxBudgetCents === null ? null : (
							<span className="text-fg-muted">
								{" "}
								/ {formatCents(key.maxBudgetCents)}
								{key.budgetReset ? ` · ${key.budgetReset}` : ""}
							</span>
						)}
					</span>
					{budgetWarning(key)}
				</div>
			),
		},
		{
			key: "limits",
			header: "Limits",
			render: (key) => {
				const limits = [
					key.rpm ? `${key.rpm} rpm` : null,
					key.tpm ? `${key.tpm} tpm` : null,
				].filter(Boolean);
				return limits.length ? (
					<span className="text-fg-muted text-xs">{limits.join(" · ")}</span>
				) : (
					<Dash />
				);
			},
		},
		{
			key: "expires",
			header: "Expires",
			render: (key) =>
				key.expiresAt ? (
					// Both the date and the "already expired" colour come from the operator's own clock
					// and timezone, which the server does not have.
					<span
						className={
							Date.parse(key.expiresAt) < Date.now()
								? "text-danger text-xs"
								: "text-fg-muted text-xs"
						}
						suppressHydrationWarning
					>
						{new Date(key.expiresAt).toLocaleDateString()}
					</span>
				) : (
					<Dash />
				),
		},
		{
			key: "state",
			header: "State",
			render: (key) => (
				<Status tone={key.enabled ? "success" : "muted"}>
					{key.enabled ? "enabled" : "disabled"}
				</Status>
			),
		},
		{
			key: "actions",
			header: "",
			align: "end",
			render: (key) =>
				writable ? (
					<RowActions
						actions={[
							{
								label: key.enabled ? "Disable" : "Enable",
								icon: key.enabled ? (
									<IconBan aria-hidden size={15} />
								) : (
									<IconCheck aria-hidden size={15} />
								),
								onSelect: () => void toggle(key),
							},
							{
								label: "Edit",
								icon: <IconPencil aria-hidden size={15} />,
								onSelect: () => edit(key),
							},
							{
								label: "Delete",
								icon: <IconTrash aria-hidden size={15} />,
								danger: true,
								onSelect: () => void remove(key),
							},
						]}
						label={`Actions for ${key.name}`}
					/>
				) : null,
		},
	];

	if (keys.length === 0) {
		return (
			<EmptyState
				description={
					searched
						? "Names and key prefixes are searched; the secret itself is stored hashed and cannot be."
						: "Create one to give a client scoped access without handing out the master key."
				}
				title={searched ? "No keys match that search" : "No virtual keys yet"}
			/>
		);
	}

	return (
		<>
			<DataTable
				caption="Virtual keys"
				columns={columns}
				rowKey={(key) => key.id}
				rows={keys}
			/>
			<Pagination
				label="keys"
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
