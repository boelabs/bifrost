"use client";

import type { CreatedVirtualKey } from "./common.ts";
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
 * The plaintext key exists only in this one response — the gateway stores a SHA-256 hash and cannot
 * return it again — so the dialog is deliberately blunt about copying it now.
 */
export function IssuedKeyDialog({
	issued,
	onClose,
}: {
	issued: CreatedVirtualKey | null;
	onClose: () => void;
}) {
	const [copied, setCopied] = useState(false);

	return (
		<Modal isOpen={issued !== null} onOpenChange={(open) => !open && onClose()}>
			<Dialog aria-label="New key created" layout="sectioned">
				<DialogHeader>
					<DialogTitle>Copy this key now</DialogTitle>
					<DialogDescription>
						It is stored hashed and will never be shown again. If you lose it,
						create a new key and delete this one.
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
