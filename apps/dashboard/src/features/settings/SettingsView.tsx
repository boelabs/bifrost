"use client";

import { type Column, DataTable, Mono } from "#/components/ui/datatable";
import { useMutation, useRowActions } from "#/shared/lib/mutation.ts";
import { clearCacheAction, deleteFallbackAction } from "./actions.ts";
import { useNotify } from "#/shared/feedback/notifications.tsx";
import { RowActions } from "#/shared/components/RowActions.tsx";
import { Can, useSession } from "#/features/auth/session.tsx";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Card, CardContent } from "#/components/ui/card";
import { useRefresh } from "#/shared/lib/useRefresh.ts";
import { FallbackDialog } from "./FallbackDialog.tsx";
import { EmptyState } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { SessionForm } from "./SessionForm.tsx";
import { RouterForm } from "./RouterForm.tsx";
import { useState } from "react";

import {
	type DashboardSettings,
	type FallbackPolicy,
	type RouterSettings,
	FALLBACK_KINDS,
} from "./common.ts";

/**
 * Router behaviour, fallback chains and the response cache.
 *
 * One component rather than the header/body split the other pages use: everything here is a form
 * over the same three fetches, and there is no filter or toolbar that could usefully arrive before
 * them.
 */
export function SettingsView({
	settings,
	sessions,
	fallbacks,
	models,
}: {
	settings: RouterSettings | null;
	/** Null when the operator's role cannot read it; the card is hidden rather than empty. */
	sessions: DashboardSettings | null;
	fallbacks: FallbackPolicy[];
	models: string[];
}) {
	const { can } = useSession();
	const { refresh } = useRefresh();
	const confirm = useConfirm();
	const notify = useNotify();
	const { run } = useMutation();
	const { rows: chains, act } = useRowActions(fallbacks, (row) => row.id);
	const [addingFallback, setAddingFallback] = useState<
		FallbackPolicy["reason"] | null
	>(null);
	const [cleared, setCleared] = useState<number | null>(null);
	const editable = can("settings:write");

	async function removeChain(row: FallbackPolicy) {
		const confirmed = await confirm({
			title: `Remove the fallback chain for ${row.primaryModel}?`,
			description: `Requests that hit this case stop being redirected to ${row.fallbackModels.join(" → ")} and fail back to the caller instead.`,
			confirmLabel: "Remove chain",
		});
		if (!confirmed) return;
		await act(row.id, {
			optimistic: "removed",
			action: () => deleteFallbackAction(row.primaryModel, row.reason),
			success: `Chain removed for ${row.primaryModel}`,
			failure: "The chain could not be removed.",
		});
	}

	async function purgeCache() {
		const confirmed = await confirm({
			title: "Clear every cached response?",
			description:
				"Cached answers are dropped across the fleet, so the next request for each of them is paid for upstream again.",
			confirmLabel: "Clear cache",
		});
		if (!confirmed) return;
		const result = await run(() => clearCacheAction(), {
			failure: "The cache could not be cleared.",
		});
		if (result.ok) {
			setCleared(result.data.deleted);
			notify.success(
				`Removed ${result.data.deleted} cached ${result.data.deleted === 1 ? "entry" : "entries"}`,
			);
		}
	}

	const fallbackColumns: Column<FallbackPolicy>[] = [
		{
			key: "primary",
			header: "Primary model",
			render: (row) => <span className="font-medium">{row.primaryModel}</span>,
		},
		{
			key: "chain",
			header: "Chain",
			render: (row) => <Mono>{row.fallbackModels.join(" → ")}</Mono>,
		},
		{
			key: "actions",
			header: "",
			align: "end",
			render: (row) =>
				editable ? (
					<RowActions
						label={`Actions for the ${row.reason} chain of ${row.primaryModel}`}
						actions={[
							{
								label: "Delete chain",
								icon: <IconTrash size={15} aria-hidden />,
								danger: true,
								onSelect: () => void removeChain(row),
							},
						]}
					/>
				) : null,
		},
	];

	return (
		<>
			<div className="flex flex-col gap-6">
				<Card>
					<CardContent className="flex flex-col gap-6 p-6">
						<div>
							<h2 className="font-semibold text-fg">Router</h2>
							<p className="pt-1 text-fg-muted text-sm">
								{settings
									? "How a request picks a deployment, and how failures take one out of rotation."
									: "Never written — the gateway is running on its defaults. Saving here writes them explicitly."}
							</p>
						</div>
						<RouterForm
							settings={settings}
							editable={editable}
							onSaved={() => {
								refresh();
								notify.success("Router settings saved");
							}}
						/>
						<p className="border-border/50 border-t pt-4 text-fg-muted text-xs">
							Execution policies (per-operation deadlines and attempt caps) are
							not edited here: they are a nested structure whose deadlines
							constrain each other, and they deserve their own editor rather
							than eight more boxes. Set them through{" "}
							<Mono>PUT /admin/router-settings</Mono> for now.
						</p>
					</CardContent>
				</Card>

				{sessions ? (
					<Card>
						<CardContent className="flex flex-col gap-6 p-6">
							<div>
								<h2 className="font-semibold text-fg">Operator sessions</h2>
								<p className="pt-1 text-fg-muted text-sm">
									How long a signed-in operator stays signed in, and what
									happens after repeated failed logins. Applies to everyone,
									including you.
								</p>
							</div>
							<SessionForm
								settings={sessions}
								editable={can("users:manage")}
								onSaved={() => {
									refresh();
									notify.success("Session policy saved");
								}}
							/>
						</CardContent>
					</Card>
				) : null}

				{FALLBACK_KINDS.map((kind) => {
					const rows = chains.filter((row) => row.reason === kind.reason);
					return (
						<Card key={kind.reason}>
							<CardContent className="p-6">
								<div className="flex flex-wrap items-start justify-between gap-3 pb-4">
									<div>
										<h2 className="font-semibold text-fg">{kind.title}</h2>
										<p className="max-w-2xl pt-1 text-fg-muted text-sm">
											{kind.description}
										</p>
									</div>
									<Can permissions={["settings:write"]}>
										<Button
											size="sm"
											onClick={() => setAddingFallback(kind.reason)}
										>
											<IconPlus size={15} aria-hidden className="mr-2" />
											New chain
										</Button>
									</Can>
								</div>
								{rows.length === 0 ? (
									<EmptyState
										title="No chain configured"
										description={kind.empty}
									/>
								) : (
									<DataTable
										rows={rows}
										columns={fallbackColumns}
										rowKey={(row) => row.id}
										caption={kind.title}
										pagination={{ pageSize: 10 }}
									/>
								)}
							</CardContent>
						</Card>
					);
				})}

				<Can permissions={["settings:write"]}>
					<Card>
						<CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
							<div>
								<h2 className="font-semibold text-fg">Response cache</h2>
								<p className="pt-1 text-fg-muted text-sm">
									{cleared === null
										? "Drops every cached response across the fleet."
										: `Removed ${cleared} cached ${cleared === 1 ? "entry" : "entries"}.`}
								</p>
							</div>
							<Button variant="secondary" onClick={() => void purgeCache()}>
								Clear cache
							</Button>
						</CardContent>
					</Card>
				</Can>
			</div>

			<FallbackDialog
				reason={addingFallback}
				models={models}
				onClose={() => setAddingFallback(null)}
				onSaved={() => {
					refresh();
					notify.success("Fallback chain saved");
				}}
			/>
		</>
	);
}
