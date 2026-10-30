"use client";

import type { CreatedVirtualKey, VirtualKey } from "./common.ts";
import { deleteKeyAction, updateKeyAction } from "./actions.ts";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { IssuedKeyDialog } from "./IssuedKeyDialog.tsx";
import { RotateKeyDialog } from "./RotateKeyDialog.tsx";
import { useMutation } from "#/shared/lib/mutation.ts";
import { Can } from "#/features/auth/session.tsx";
import { Button } from "#/components/ui/button";
import { useCopyKey } from "./useCopyKey.ts";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
	RefreshCw as IconRotate,
	Trash2 as IconTrash,
	Copy as IconCopy,
} from "lucide-react";

/**
 * A key page's header actions: copying it, regenerating it, turning it on or off, and deleting it.
 * Only for roles that may write keys — copying included, since a copied key is as good as a written
 * one; everyone else reads the form.
 */
export function KeyHeaderActions({ apiKey }: { apiKey: VirtualKey }) {
	return (
		<Can permissions={["keys:write"]}>
			<Actions apiKey={apiKey} />
		</Can>
	);
}

function Actions({ apiKey }: { apiKey: VirtualKey }) {
	const router = useRouter();
	const confirm = useConfirm();
	const { pending, run } = useMutation();
	const { copy, copying } = useCopyKey();
	const [rotating, setRotating] = useState(false);
	const [issued, setIssued] = useState<CreatedVirtualKey | null>(null);

	async function toggle() {
		const result = await run(
			() => updateKeyAction(apiKey.id, { enabled: !apiKey.enabled }),
			{
				success: `${apiKey.name} ${apiKey.enabled ? "disabled" : "enabled"}`,
				failure: "The key could not be updated.",
			},
		);
		if (result.ok) {
			router.refresh();
		}
	}

	async function remove() {
		const confirmed = await confirm({
			title: `Delete ${apiKey.name}?`,
			description:
				"Any client still sending this key starts failing immediately, and the secret cannot be restored — a replacement is a new key.",
			confirmLabel: "Delete key",
		});
		if (!confirmed) {
			return;
		}
		// Leaving in the same transition as the action: the revalidated render of this page no longer
		// finds the key, and it must not be painted before the list is.
		await run(
			async () => {
				const result = await deleteKeyAction(apiKey.id);
				if (result.ok) {
					router.push("/keys");
				}
				return result;
			},
			{
				success: `${apiKey.name} deleted`,
				failure: "The key could not be deleted.",
			},
		);
	}

	return (
		<>
			<Button
				disabled={pending}
				onClick={() => void remove()}
				variant="danger-outline"
			>
				<IconTrash aria-hidden className="size-4" />
				Delete
			</Button>
			<Button
				disabled={pending}
				onClick={() => void toggle()}
				variant="secondary"
			>
				{apiKey.enabled ? "Disable" : "Enable"}
			</Button>
			<Button
				disabled={pending}
				onClick={() => setRotating(true)}
				variant="secondary"
			>
				<IconRotate aria-hidden className="size-4" />
				Regenerate
			</Button>
			{apiKey.copyable ? (
				<Button
					disabled={copying !== null}
					onClick={() => copy(apiKey)}
					variant="secondary"
				>
					<IconCopy aria-hidden className="size-4" />
					Copy key
				</Button>
			) : null}
			<RotateKeyDialog
				apiKey={apiKey}
				isOpen={rotating}
				key={`${apiKey.id}:${apiKey.private}`}
				onClose={() => setRotating(false)}
				onRotated={setIssued}
			/>
			<IssuedKeyDialog
				issued={issued}
				onClose={() => setIssued(null)}
				rotated
			/>
		</>
	);
}
