"use client";

import type { CreatedVirtualKey, VirtualKey } from "./common.ts";
import { PrivateKeySwitch } from "./PrivateKeySwitch.tsx";
import { useMutation } from "#/shared/lib/mutation.ts";
import { Button } from "#/components/ui/button";
import { rotateKeyAction } from "./actions.ts";
import { Form } from "#/components/ui/form";
import { useState } from "react";

import {
	DialogDescription,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogBody,
	Dialog,
	Modal,
} from "#/components/ui/modal";

/**
 * Regenerating is the confirmation and the one choice that comes with it: whether the new secret is
 * stored. It starts at the key's current setting, so regenerating never quietly changes it — and it
 * is the only way a private key becomes copyable, because its old secret no longer exists anywhere.
 *
 * The choice is seeded once from the key; the parent remounts the dialog (`key`) when the key's
 * setting changes, and closing without regenerating puts it back.
 *
 * No idempotency key on purpose: a retried rotation simply issues one more secret and retires the
 * previous one, which is what the operator asked for, and no response carrying a secret is kept.
 */
export function RotateKeyDialog({
	apiKey,
	isOpen,
	onClose,
	onRotated,
}: {
	apiKey: VirtualKey;
	isOpen: boolean;
	onClose: () => void;
	onRotated: (issued: CreatedVirtualKey) => void;
}) {
	const { pending, run } = useMutation();
	const [keepPrivate, setKeepPrivate] = useState(apiKey.private);

	function close() {
		setKeepPrivate(apiKey.private);
		onClose();
	}

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const result = await run(
			() => rotateKeyAction(apiKey.id, { private: keepPrivate }),
			{ failure: "The key could not be regenerated." },
		);
		if (result.ok) {
			close();
			onRotated(result.data);
		}
	}

	return (
		<Modal
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) {
					close();
				}
			}}
		>
			<Dialog aria-label={`Regenerate ${apiKey.name}`} layout="sectioned">
				<DialogHeader>
					<DialogTitle>Regenerate {apiKey.name}?</DialogTitle>
					<DialogDescription>
						Clients still sending the current secret start failing immediately.
						Limits, spend and logs stay with the key.
					</DialogDescription>
				</DialogHeader>
				<Form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
					<DialogBody>
						<PrivateKeySwitch
							checked={keepPrivate}
							onCheckedChange={setKeepPrivate}
						/>
					</DialogBody>
					<DialogFooter>
						<Button onClick={close} type="button" variant="secondary">
							Cancel
						</Button>
						<Button disabled={pending} type="submit" variant="danger">
							{pending ? "Regenerating…" : "Regenerate key"}
						</Button>
					</DialogFooter>
				</Form>
			</Dialog>
		</Modal>
	);
}
