"use client";

import { deleteDeploymentAction, toggleDeploymentAction } from "./actions.ts";
import { createContext, Suspense, use, useMemo, useState } from "react";
import { ButtonSkeleton } from "#/shared/components/Skeleton.tsx";
import type { AdapterSummary, Deployment } from "./common.ts";
import { Can, useSession } from "#/features/auth/session.tsx";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { DeploymentDialog } from "./DeploymentDialog.tsx";
import { useRowActions } from "#/shared/lib/mutation.ts";
import { useRefresh } from "#/shared/lib/useRefresh.ts";
import { Button } from "#/components/ui/button";
import { Plus as IconPlus } from "lucide-react";
import { ModelsTable } from "./ModelsTable";

/** `deployment: null` opens the dialog for a new one; a row opens it for editing that one. */
type Editing = { deployment: Deployment | null } | null;

interface ModelsValue {
	openNew: () => void;
	edit: (deployment: Deployment) => void;
}

const ModelsContext = createContext<ModelsValue | null>(null);

function useModels(): ModelsValue {
	const value = use(ModelsContext);
	if (!value) {
		throw new Error("useModels must be used inside ModelsProvider");
	}
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
			adapters={use(adapters)}
			isOpen
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
			<Button onClick={openNew} size="sm">
				<IconPlus aria-hidden className="size-4" />
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
		<Suspense fallback={<ButtonSkeleton label={14} />}>
			<NewDeployment />
		</Suspense>
	);
}

/**
 * The models page below its header.
 *
 * Each row acts on one deployment; deletion checks the complete public model pool.
 */
export function ModelsView({ deployments }: { deployments: Deployment[] }) {
	const confirm = useConfirm();
	const { edit } = useModels();
	const { rows, act } = useRowActions(deployments, (row) => row.id);
	const { can } = useSession();

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
		if (!confirmed) {
			return;
		}
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
		<ModelsTable
			deployments={[...rows]}
			onDelete={(deployment) => void remove(deployment)}
			onEdit={edit}
			onToggle={(deployment) => void toggle(deployment)}
			writable={can("deployments:write")}
		/>
	);
}
