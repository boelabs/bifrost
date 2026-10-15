"use client";

import { deleteDeploymentAction, toggleDeploymentAction } from "./actions.ts";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { useMutation } from "#/shared/lib/mutation.ts";
import { Can } from "#/features/auth/session.tsx";
import { Button } from "#/components/ui/button";
import type { Deployment } from "./common.ts";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/**
 * A deployment page's header actions: turning it on or off, and deleting it. Only for roles that
 * may write deployments; everyone else reads the form.
 */
export function DeploymentHeaderActions({
	deployment,
	siblings,
}: {
	deployment: Deployment;
	/** Other enabled deployments of the same public model, to say what deleting this one does. */
	siblings: number;
}) {
	return (
		<Can permissions={["deployments:write"]}>
			<Actions deployment={deployment} siblings={siblings} />
		</Can>
	);
}

function Actions({
	deployment,
	siblings,
}: {
	deployment: Deployment;
	siblings: number;
}) {
	const router = useRouter();
	const confirm = useConfirm();
	const { pending, run } = useMutation();

	async function toggle() {
		const result = await run(
			() => toggleDeploymentAction(deployment.id, !deployment.enabled),
			{
				success: `${deployment.upstreamModel} ${deployment.enabled ? "disabled" : "enabled"}`,
				failure: "The deployment could not be updated.",
			},
		);
		if (result.ok) {
			router.refresh();
		}
	}

	async function remove() {
		const last = deployment.enabled && siblings === 0;
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
		const result = await run(() => deleteDeploymentAction(deployment.id), {
			success: `${deployment.upstreamModel} removed from ${deployment.publicModel}`,
			failure: "The deployment could not be deleted.",
		});
		if (result.ok) {
			router.push("/models");
		}
	}

	return (
		<>
			<Button
				disabled={pending}
				onClick={() => void remove()}
				variant="danger-outline"
			>
				<Trash2 aria-hidden className="size-4" />
				Delete
			</Button>
			<Button
				disabled={pending}
				onClick={() => void toggle()}
				variant="secondary"
			>
				{deployment.enabled ? "Disable" : "Enable"}
			</Button>
		</>
	);
}
