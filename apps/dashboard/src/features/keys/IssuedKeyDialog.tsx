"use client";

import { type CreatedVirtualKey, secretState } from "./common.ts";
import { Button } from "#/components/ui/button";
import { Copy as IconCopy } from "lucide-react";
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
 * Whether this is the last chance to copy decides how blunt the dialog is: a private key is never
 * shown again, and neither, for now, is any key on a gateway that seals copying.
 */
function describe(issued: CreatedVirtualKey, rotated: boolean): string {
	const replaced = rotated ? "The previous secret has stopped working. " : "";
	switch (secretState(issued)) {
		case "copyable":
			return `${replaced}You can copy it again later with Copy key.`;
		case "private":
			return `${replaced}It is a private key: it is not stored and will never be shown again. If you lose it, regenerate it.`;
		case "sealed":
			return `${replaced}Copying keys is turned off on this gateway, so it cannot be copied again until that changes.`;
		default:
			return replaced;
	}
}

function title(issued: CreatedVirtualKey | null, rotated: boolean): string {
	if (issued !== null && secretState(issued) !== "copyable") {
		return "Copy this key now";
	}
	return rotated ? "Key regenerated" : "Key created";
}

export function IssuedKeyDialog({
	issued,
	rotated = false,
	onClose,
}: {
	issued: CreatedVirtualKey | null;
	/** The key existed already and this is its new secret. */
	rotated?: boolean;
	onClose: () => void;
}) {
	const [copied, setCopied] = useState(false);

	return (
		<Modal isOpen={issued !== null} onOpenChange={(open) => !open && onClose()}>
			<Dialog
				aria-label={rotated ? "Key regenerated" : "New key created"}
				layout="sectioned"
			>
				<DialogHeader>
					<DialogTitle>{title(issued, rotated)}</DialogTitle>
					<DialogDescription>
						{issued ? describe(issued, rotated) : null}
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<pre className="overflow-x-auto rounded-xl border border-border/50 bg-surface-2 px-3 py-2.5 font-mono text-fg text-xs">
						{issued?.key}
					</pre>
				</DialogBody>
				<DialogFooter>
					<Button
						onClick={async () => {
							if (issued) {
								await navigator.clipboard.writeText(issued.key);
							}
							setCopied(true);
						}}
						variant="secondary"
					>
						<IconCopy aria-hidden className="size-4" />
						{copied ? "Copied" : "Copy"}
					</Button>
					<Button
						onClick={() => {
							setCopied(false);
							onClose();
						}}
					>
						Done
					</Button>
				</DialogFooter>
			</Dialog>
		</Modal>
	);
}
