"use client";

import { deleteDeploymentAction, toggleDeploymentAction } from "./actions.ts";
import { ButtonSkeleton } from "#/shared/components/Skeleton.tsx";
import { Can, useSession } from "#/features/auth/session.tsx";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { useRowActions } from "#/shared/lib/mutation.ts";
import { Button } from "#/components/ui/button";
import { Plus as IconPlus } from "lucide-react";
import type { Deployment } from "./common.ts";
import { useRouter } from "next/navigation";
import { ModelsTable } from "./ModelsTable";
import { Suspense } from "react";
import Link from "next/link";

/** The "New deployment" button: the editor is a page of its own. */
function NewDeployment() {
	return (
		<Can permissions={["deployments:write"]}>
			<Button nativeButton={false} render={<Link href="/models/new" />}>
				<IconPlus aria-hidden className="size-4" />
				New deployment
			</Button>
		</Can>
	);
}

/**
 * Its own `<Suspense>` boundary: the button waits on the operator's permissions, and a `<Suspense>`
 * the page passes *into* `PageHeader` does not count as one during prerendering.
 */
export function NewDeploymentButton() {
	return (
		<Suspense fallback={<ButtonSkeleton label={14} size="md" />}>
			<NewDeployment />
		</Suspense>
	);
}

/**
 * The models page below its header.
 *
 * Each row opens its deployment's page; the row menu toggles or deletes it in place, and deletion
 * checks the complete public model pool.
 */
export function ModelsView({ deployments }: { deployments: Deployment[] }) {
	const router = useRouter();
	const confirm = useConfirm();
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
			onEdit={(deployment) => router.push(`/models/${deployment.id}`)}
			onToggle={(deployment) => void toggle(deployment)}
			writable={can("deployments:write")}
		/>
	);
}
