"use client";

import { uploadArtifactAction } from "./actions.ts";
import { Textarea } from "#/components/ui/textarea";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { STARTER_MODULE } from "./common.ts";
import { Form } from "#/components/ui/form";
import { useState } from "react";

import {
	DialogHeader,
	DialogFooter,
	DialogBody,
	Dialog,
	Modal,
} from "#/components/ui/modal";

/**
 * Uploading code creates a NEW version and activates it; the previous versions stay and can be
 * activated again. The gateway probes the module before storing it, so a module that does not load
 * is rejected here rather than at the first request that would have used it.
 */
export function UploadDialog({
	isOpen,
	initialKey,
	onClose,
	onSaved,
}: {
	isOpen: boolean;
	initialKey: string | null;
	onClose: () => void;
	onSaved: () => Promise<void> | void;
}) {
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setPending(true);
		const form = new FormData(event.currentTarget);
		try {
			const result = await uploadArtifactAction({
				key: String(form.get("key") ?? "").trim(),
				code: String(form.get("code") ?? ""),
			});
			if (!result.ok) {
				setError(result.message);
				return;
			}
			await onSaved();
			onClose();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not upload the module.",
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
			<Dialog aria-label="Upload extension code" layout="sectioned">
				<DialogHeader>
					<h2 className="font-semibold text-fg text-lg">
						{initialKey ? `New version of ${initialKey}` : "Upload extension"}
					</h2>
					<p className="pt-2 text-fg-muted text-sm">
						An ES module exporting a definition. It is probed on upload and
						becomes the active version immediately; earlier versions are kept.
					</p>
				</DialogHeader>

				<Form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
					<DialogBody>
						<Input
							autoFocus={initialKey === null}
							defaultValue={initialKey ?? ""}
							description="Lowercase letters and digits. Uploading an existing key adds a version to it."
							label="Key"
							name="key"
							pattern="[a-z0-9]+"
							readOnly={initialKey !== null}
							required
						/>
						<Textarea
							className="font-mono text-xs"
							defaultValue={STARTER_MODULE}
							description="The starter below logs every request and response. Replace it with your own."
							label="Module"
							name="code"
							required
							rows={18}
						/>

						{error ? <ErrorNote>{error}</ErrorNote> : null}
					</DialogBody>
					<DialogFooter>
						<Button onClick={onClose} variant="secondary">
							Cancel
						</Button>
						<Button disabled={pending} type="submit">
							{pending ? "Probing…" : "Upload and activate"}
						</Button>
					</DialogFooter>
				</Form>
			</Dialog>
		</Modal>
	);
}
