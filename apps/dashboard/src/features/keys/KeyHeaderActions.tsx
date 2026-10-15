"use client";

import { deleteKeyAction, updateKeyAction } from "./actions.ts";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { useMutation } from "#/shared/lib/mutation.ts";
import { Trash2 as IconTrash } from "lucide-react";
import { Can } from "#/features/auth/session.tsx";
import { Button } from "#/components/ui/button";
import type { VirtualKey } from "./common.ts";
import { useRouter } from "next/navigation";

/**
 * A key page's header actions: turning it on or off, and deleting it. Only for roles that may write
 * keys; everyone else reads the form.
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
		</>
	);
}
