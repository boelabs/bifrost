"use client";

import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
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
 * An owner setting someone else's password is always issuing a temporary one — they are handing it
 * over in person or in a message, so it has to stop working as a credential the moment it is used.
 * That is why `mustChangePassword` is not offered as a choice here.
 */
export function PasswordDialog({
	username,
	isOpen,
	pending,
	onClose,
	onSubmit,
}: {
	username: string;
	isOpen: boolean;
	pending: boolean;
	onClose: () => void;
	onSubmit: (password: string) => Promise<boolean>;
}) {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (password.length < 12) {
			setError("At least 12 characters.");
			return;
		}
		setError(null);
		if (await onSubmit(password)) {
			setPassword("");
			onClose();
		}
	}

	return (
		<Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
			<Dialog layout="sectioned" aria-label={`Reset password for ${username}`}>
				<DialogHeader>
					<h2 className="font-semibold text-fg text-lg">
						Reset password for {username}
					</h2>
					<p className="pt-2 text-fg-muted text-sm">
						They must change it the next time they sign in, and every session
						they have open is revoked.
					</p>
				</DialogHeader>
				<Form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
					<DialogBody>
						<Input
							label="Temporary password"
							type="password"
							value={password}
							onValueChange={setPassword}
							description="At least 12 characters."
							required
							autoFocus
						/>
						{error ? <ErrorNote>{error}</ErrorNote> : null}
					</DialogBody>
					<DialogFooter>
						<Button type="button" variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={pending}>
							{pending ? "Saving…" : "Set password"}
						</Button>
					</DialogFooter>
				</Form>
			</Dialog>
		</Modal>
	);
}
