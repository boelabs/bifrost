"use client";

import { type Column, DataTable, Dash } from "#/components/ui/datatable";
import { type KeysFilters, isFiltered, PAGE_SIZE } from "./filters.ts";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { Pagination } from "#/shared/components/Pagination.tsx";
import { deleteKeyAction, updateKeyAction } from "./actions.ts";
import { RowActions } from "#/shared/components/RowActions.tsx";
import { formatCents, type VirtualKey } from "./common.ts";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { useRowActions } from "#/shared/lib/mutation.ts";
import { useSession } from "#/features/auth/session.tsx";
import { EmptyState } from "#/components/ui/page";
import { NewKeyButton } from "./KeysToolbar.tsx";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import { useCopyKey } from "./useCopyKey.ts";
import { useRouter } from "next/navigation";

import {
	KeyRound as IconKeyRound,
	SearchX as IconSearchX,
	Pencil as IconPencil,
	Trash2 as IconTrash,
	Check as IconCheck,
	Copy as IconCopy,
	Ban as IconBan,
} from "lucide-react";

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
		return <Status tone="danger">Budget spent</Status>;
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
	const { set, clear } = useSearchWriter(filters);
	const { can } = useSession();
	const router = useRouter();
	const confirm = useConfirm();
	const { rows: keys, act } = useRowActions(loaded, (key) => key.id);
	const { copy, copying } = useCopyKey();
	const filtered = isFiltered(filters);
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
					<span className="text-fg-muted">All</span>
				) : (
					key.allowedModels.join(", ")
				),
		},
		{
			key: "spend",
			header: "Spend",
			align: "end",
			render: (key) => (
				<div className="flex flex-wrap items-center justify-end gap-2">
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
								? "text-danger text-xs tabular-nums"
								: "text-fg-muted text-xs tabular-nums"
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
				<Status tone={key.enabled ? "success" : "neutral"}>
					{key.enabled ? "Enabled" : "Disabled"}
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
							...(key.copyable
								? [
										{
											label: "Copy key",
											icon: <IconCopy aria-hidden className="size-4" />,
											disabled: copying === key.id,
											onSelect: () => copy(key),
										},
									]
								: []),
							{
								label: key.enabled ? "Disable" : "Enable",
								icon: key.enabled ? (
									<IconBan aria-hidden className="size-4" />
								) : (
									<IconCheck aria-hidden className="size-4" />
								),
								onSelect: () => void toggle(key),
							},
							{
								label: "Edit",
								icon: <IconPencil aria-hidden className="size-4" />,
								onSelect: () => router.push(`/keys/${key.id}`),
							},
							{
								label: "Delete",
								icon: <IconTrash aria-hidden className="size-4" />,
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
		return filtered ? (
			<EmptyState
				description="Nothing matches the search or the state you chose. Only names and key prefixes are searched."
				icon={IconSearchX}
				title="No keys match"
			>
				<Button onClick={() => clear()} variant="secondary">
					Clear filters
				</Button>
			</EmptyState>
		) : (
			<EmptyState
				description="Create one to give a client scoped access without handing out the master key."
				icon={IconKeyRound}
				title="No API keys yet"
			>
				<NewKeyButton />
			</EmptyState>
		);
	}

	return (
		<>
			<DataTable
				caption="Virtual keys"
				columns={columns}
				rowHref={(key) => `/keys/${key.id}`}
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
