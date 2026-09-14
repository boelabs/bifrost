"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { deleteDeploymentAction, toggleDeploymentAction } from "./actions.ts";
import { createContext, Suspense, use, useMemo, useState } from "react";
import { RowActions } from "#/shared/components/RowActions.tsx";
import { Can, useSession } from "#/features/auth/session.tsx";
import { Skeleton } from "#/shared/components/Skeleton.tsx";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { DeploymentDialog } from "./DeploymentDialog.tsx";
import { Card, CardContent } from "#/components/ui/card";
import { useRowActions } from "#/shared/lib/mutation.ts";
import { useRefresh } from "#/shared/lib/useRefresh.ts";
import { EmptyState } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";

import {
	IconPencil,
	IconCheck,
	IconTrash,
	IconPlus,
	IconBan,
} from "@tabler/icons-react";

import {
	type AdapterSummary,
	groupByPublicModel,
	type Deployment,
} from "./common.ts";

/** `deployment: null` opens the dialog for a new one; a row opens it for editing that one. */
type Editing = { deployment: Deployment | null } | null;

interface ModelsValue {
	openNew: () => void;
	edit: (deployment: Deployment) => void;
}

const ModelsContext = createContext<ModelsValue | null>(null);

function useModels(): ModelsValue {
	const value = use(ModelsContext);
	if (!value) throw new Error("useModels must be used inside ModelsProvider");
	return value;
}

/**
 * The deployment dialog, shared by the "New deployment" button in the page header and the edit
 * button on every row further down — two different `<Suspense>` boundaries, one dialog.
 *
 * `adapters` arrives as an unawaited promise so the header does not wait on the adapter registry; it
 * is only unwrapped once the dialog is actually open.
 */
export function ModelsProvider({
	adapters,
	children,
}: {
	adapters: Promise<AdapterSummary[]>;
	children: React.ReactNode;
}) {
	const { refresh } = useRefresh();
	const [editing, setEditing] = useState<Editing>(null);
	const value = useMemo<ModelsValue>(
		() => ({
			openNew: () => setEditing({ deployment: null }),
			edit: (deployment) => setEditing({ deployment }),
		}),
		[],
	);
	return (
		<ModelsContext value={value}>
			{children}
			{editing ? (
				<Suspense fallback={null}>
					<DeploymentEditor
						adapters={adapters}
						existing={editing.deployment}
						onClose={() => setEditing(null)}
						onSaved={refresh}
					/>
				</Suspense>
			) : null}
		</ModelsContext>
	);
}

/** Unwraps the adapter registry where suspending costs a dialog rather than the page. */
function DeploymentEditor({
	adapters,
	existing,
	onClose,
	onSaved,
}: {
	adapters: Promise<AdapterSummary[]>;
	existing: Deployment | null;
	onClose: () => void;
	onSaved: () => void;
}) {
	return (
		<DeploymentDialog
			isOpen
			adapters={use(adapters)}
			{...(existing ? { existing } : {})}
			onClose={onClose}
			onSaved={onSaved}
		/>
	);
}

/** The "New deployment" button, which lives up in the page header. */
function NewDeployment() {
	const { openNew } = useModels();
	return (
		<Can permissions={["deployments:write"]}>
			<Button size="sm" onClick={openNew}>
				<IconPlus size={15} aria-hidden className="mr-2" />
				New deployment
			</Button>
		</Can>
	);
}

/**
 * Its own `<Suspense>` boundary: the button waits on the operator's permissions, and a `<Suspense>`
 * the page passes *into* `PageHeader` (a Client Component) does not count as one during prerendering.
 */
export function NewDeploymentButton() {
	return (
		<Suspense
			fallback={
				<Skeleton
					className="h-8 rounded-[var(--ui-radius-control)]"
					width="9.5rem"
				/>
			}
		>
			<NewDeployment />
		</Suspense>
	);
}

/**
 * The models page below its header.
 *
 * Grouping happens here rather than on the server because a Public Model is not a row: it is every
 * deployment that shares a `publicModel`, and the gateway returns the deployments. See the glossary.
 */
export function ModelsView({ deployments }: { deployments: Deployment[] }) {
	const confirm = useConfirm();
	const { openNew, edit } = useModels();
	const { rows, act } = useRowActions(deployments, (row) => row.id);
	const groups = groupByPublicModel([...rows]);

	async function remove(deployment: Deployment) {
		const siblings = rows.filter(
			(row) => row.publicModel === deployment.publicModel && row.enabled,
		);
		const last = deployment.enabled && siblings.length === 1;
		const confirmed = await confirm({
			title: `Delete this ${deployment.adapterKey} deployment?`,
			description: last
				? `${deployment.publicModel} has no other enabled deployment, so deleting this one stops the model from routing at all.`
				: `Requests for ${deployment.publicModel} will be spread across its remaining deployments. Credentials stored here are removed with it.`,
			confirmLabel: "Delete deployment",
		});
		if (!confirmed) return;
		await act(deployment.id, {
			optimistic: "removed",
			action: () => deleteDeploymentAction(deployment.id),
			success: `${deployment.upstreamModel} removed from ${deployment.publicModel}`,
			failure: "The deployment could not be deleted.",
		});
	}

	async function toggle(deployment: Deployment) {
		await act(deployment.id, {
			optimistic: { enabled: !deployment.enabled },
			action: () => toggleDeploymentAction(deployment.id, !deployment.enabled),
			success: `${deployment.upstreamModel} ${deployment.enabled ? "disabled" : "enabled"}`,
			failure: "The deployment could not be updated.",
		});
	}

	return (
		<>
			{groups.length === 0 ? (
				<EmptyState
					title="No deployments yet"
					description="Create the first one and its public model appears here."
				>
					<Can permissions={["deployments:write"]}>
						<Button onClick={openNew}>New deployment</Button>
					</Can>
				</EmptyState>
			) : (
				<div className="flex flex-col gap-6">
					{groups.map((group) => (
						<PublicModelCard
							key={group.publicModel}
							name={group.publicModel}
							enabledCount={group.enabledCount}
							adapters={group.adapters}
							deployments={group.deployments}
							onEdit={edit}
							onToggle={(deployment) => void toggle(deployment)}
							onDelete={(deployment) => void remove(deployment)}
						/>
					))}
				</div>
			)}
		</>
	);
}

function PublicModelCard({
	name,
	enabledCount,
	adapters,
	deployments,
	onEdit,
	onToggle,
	onDelete,
}: {
	name: string;
	enabledCount: number;
	adapters: string[];
	deployments: Deployment[];
	onEdit: (deployment: Deployment) => void;
	onToggle: (deployment: Deployment) => void;
	onDelete: (deployment: Deployment) => void;
}) {
	const { can } = useSession();
	const writable = can("deployments:write");

	const columns: Column<Deployment>[] = [
		{
			key: "upstream",
			header: "Upstream model",
			render: (row) => <span className="font-medium">{row.upstreamModel}</span>,
		},
		{
			key: "adapter",
			header: "Adapter",
			render: (row) => <Mono>{row.adapterKey}</Mono>,
		},
		{ key: "label", header: "Label", render: (row) => row.label ?? <Dash /> },
		{
			key: "weight",
			header: "Weight",
			render: (row) => <span className="tabular-nums">{row.weight}</span>,
		},
		{
			key: "limits",
			header: "Limits",
			render: (row) => {
				const limits = [
					row.rpmLimit ? `${row.rpmLimit} rpm` : null,
					row.tpmLimit ? `${row.tpmLimit} tpm` : null,
				].filter(Boolean);
				return limits.length ? (
					<span className="text-fg-muted text-xs">{limits.join(" · ")}</span>
				) : (
					<Dash />
				);
			},
		},
		{
			key: "source",
			header: "Catalog",
			render: (row) => (
				<Status tone={row.custom ? "warning" : "muted"}>
					{row.custom ? "custom" : "built-in"}
				</Status>
			),
		},
		{
			key: "state",
			header: "State",
			render: (row) => (
				<Status tone={row.enabled ? "success" : "muted"}>
					{row.enabled ? "enabled" : "disabled"}
				</Status>
			),
		},
		{
			key: "actions",
			header: "",
			align: "end",
			render: (row) =>
				writable ? (
					<RowActions
						label={`Actions for deployment ${row.upstreamModel}`}
						actions={[
							{
								label: row.enabled ? "Disable" : "Enable",
								icon: row.enabled ? (
									<IconBan size={15} aria-hidden />
								) : (
									<IconCheck size={15} aria-hidden />
								),
								onSelect: () => onToggle(row),
							},
							{
								label: "Edit",
								icon: <IconPencil size={15} aria-hidden />,
								onSelect: () => onEdit(row),
							},
							{
								label: "Delete",
								icon: <IconTrash size={15} aria-hidden />,
								danger: true,
								onSelect: () => onDelete(row),
							},
						]}
					/>
				) : null,
		},
	];

	return (
		<Card className="p-0 effect-3d">
			<div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
				<div>
					<h2 className="font-semibold text-fg text-lg">{name}</h2>
					<p className="mt-0.5 text-fg-muted text-xs">
						{deployments.length} deployment{deployments.length === 1 ? "" : "s"}{" "}
						· {enabledCount} enabled · {adapters.join(", ")}
					</p>
				</div>
				<Status tone={enabledCount > 0 ? "success" : "danger"}>
					{enabledCount > 0 ? "routable" : "no enabled deployment"}
				</Status>
			</div>
			<CardContent className="p-0">
				<DataTable
					rows={deployments}
					columns={columns}
					rowKey={(row) => row.id}
					caption={`Deployments for ${name}`}
					pagination={{ pageSize: 10 }}
				/>
			</CardContent>
		</Card>
	);
}
