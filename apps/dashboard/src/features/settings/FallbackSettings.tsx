"use client";

import { ButtonSkeleton, TableSkeleton } from "#/shared/components/Skeleton";
import { type Column, DataTable, Mono } from "#/components/ui/datatable";
import { Plus as IconPlus, Trash2 as IconTrash } from "lucide-react";
import { type FallbackPolicy, FALLBACK_KINDS } from "./common.ts";
import { useNotify } from "#/shared/feedback/notifications.tsx";
import { RowActions } from "#/shared/components/RowActions.tsx";
import { TextSkeleton } from "#/shared/components/TextSkeleton";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { useRowActions } from "#/shared/lib/mutation.ts";
import { useSession } from "#/features/auth/session.tsx";
import { useRefresh } from "#/shared/lib/useRefresh.ts";
import { Panel } from "#/shared/components/Panel.tsx";
import { FallbackDialog } from "./FallbackDialog.tsx";
import { deleteFallbackAction } from "./actions.ts";
import { EmptyState } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { useState } from "react";

const HEADERS = ["Primary model", "Chain", ""] as const;

/** One panel per case a chain answers, each with its chains and a way to add one. */
export function FallbackSettings({
	fallbacks,
	models,
}: {
	fallbacks: FallbackPolicy[];
	models: string[];
}) {
	const { can } = useSession();
	const { refresh } = useRefresh();
	const confirm = useConfirm();
	const notify = useNotify();
	const { rows: chains, act } = useRowActions(fallbacks, (row) => row.id);
	const [adding, setAdding] = useState<FallbackPolicy["reason"] | null>(null);
	const editable = can("settings:write");

	async function removeChain(row: FallbackPolicy) {
		const confirmed = await confirm({
			title: `Remove the fallback chain for ${row.primaryModel}?`,
			description: `Requests that hit this case stop being redirected to ${row.fallbackModels.join(" → ")} and fail back to the caller instead.`,
			confirmLabel: "Remove chain",
		});
		if (!confirmed) {
			return;
		}
		await act(row.id, {
			optimistic: "removed",
			action: () => deleteFallbackAction(row.primaryModel, row.reason),
			success: `Chain removed for ${row.primaryModel}`,
			failure: "The chain could not be removed.",
		});
	}

	const columns: Column<FallbackPolicy>[] = [
		{
			key: "primary",
			header: HEADERS[0],
			render: (row) => <span className="font-medium">{row.primaryModel}</span>,
		},
		{
			key: "chain",
			header: HEADERS[1],
			render: (row) => <Mono>{row.fallbackModels.join(" → ")}</Mono>,
		},
		{
			key: "actions",
			header: HEADERS[2],
			align: "end",
			render: (row) =>
				editable ? (
					<RowActions
						actions={[
							{
								label: "Delete chain",
								icon: <IconTrash aria-hidden className="size-4" />,
								danger: true,
								onSelect: () => void removeChain(row),
							},
						]}
						label={`Actions for the ${row.reason} chain of ${row.primaryModel}`}
					/>
				) : null,
		},
	];

	return (
		<>
			{FALLBACK_KINDS.map((kind) => {
				const rows = chains.filter((row) => row.reason === kind.reason);
				return (
					<Panel
						action={
							editable ? (
								<Button
									onClick={() => setAdding(kind.reason)}
									size="sm"
									variant="secondary"
								>
									<IconPlus aria-hidden className="size-4" />
									New chain
								</Button>
							) : null
						}
						description={kind.description}
						key={kind.reason}
						title={kind.title}
					>
						{rows.length === 0 ? (
							<EmptyState
								description={kind.empty}
								framed={false}
								title="No chain configured"
							/>
						) : (
							<DataTable
								caption={kind.title}
								columns={columns}
								pagination={{ pageSize: 10 }}
								rowKey={(row) => row.id}
								rows={rows}
								variant="plain"
							/>
						)}
					</Panel>
				);
			})}

			<FallbackDialog
				models={models}
				onClose={() => setAdding(null)}
				onSaved={() => {
					refresh();
					notify.success("Fallback chain saved");
				}}
				reason={adding}
			/>
		</>
	);
}

export function FallbackSettingsSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading fallback chains"
			className="flex flex-col gap-6"
			role="status"
		>
			{FALLBACK_KINDS.map(({ reason, title, description }) => (
				<div aria-hidden="true" className="contents" key={reason}>
					<Panel
						action={<ButtonSkeleton label={9} />}
						description={<TextSkeleton length={description.length} />}
						title={<TextSkeleton length={title.length} />}
					>
						<TableSkeleton headers={HEADERS} pagination plain rows={3} />
					</Panel>
				</div>
			))}
		</div>
	);
}
