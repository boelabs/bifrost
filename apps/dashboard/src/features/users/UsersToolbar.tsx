"use client";

import { useIdempotencyKey } from "#/shared/lib/useIdempotencyKey.ts";
import { SearchField } from "#/shared/components/SearchField.tsx";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { type Role, ROLE_SUMMARY, ROLES } from "./common.ts";
import { Select, SelectItem } from "#/components/ui/select";
import { useMutation } from "#/shared/lib/mutation.ts";
import type { UsersFilters } from "./filters.ts";
import { ErrorNote } from "#/components/ui/page";
import { createUserAction } from "./actions.ts";
import { Button } from "#/components/ui/button";
import { IconPlus } from "@tabler/icons-react";
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
 * Search and "New user". Unlike the other pages, the dialog it opens lives here rather than in a
 * shared provider: creating an operator needs nothing from the table it will appear in.
 */
export function UsersToolbar({ filters }: { filters: UsersFilters }) {
	const { filter } = useSearchWriter(filters);
	const [creating, setCreating] = useState(false);
	return (
		<div className="flex flex-wrap items-center gap-3">
			<SearchField
				label="Search users"
				onSearch={(value) => filter({ q: value })}
				placeholder="Username"
				value={filters.q ?? ""}
			/>
			<Button onClick={() => setCreating(true)} size="sm">
				<IconPlus aria-hidden className="mr-2" size={15} />
				New user
			</Button>
			<CreateUserDialog isOpen={creating} onClose={() => setCreating(false)} />
		</div>
	);
}

function CreateUserDialog({
	isOpen,
	onClose,
}: {
	isOpen: boolean;
	onClose: () => void;
}) {
	const { pending, run } = useMutation();
	const created = useIdempotencyKey();
	const [role, setRole] = useState<Role | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		if (!role) {
			setError("Choose a role.");
			return;
		}
		const form = new FormData(event.currentTarget);
		const username = String(form.get("username"));
		const result = await run(
			() =>
				createUserAction(
					{
						username,
						password: String(form.get("password")),
						role,
						mustChangePassword: true,
					},
					created.key(),
				),
			{
				success: `${username} created`,
				failure: "The operator could not be created.",
			},
		);
		if (!result.ok) {
			setError(result.message);
			return;
		}
		created.rotate();
		onClose();
	}

	return (
		<Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
			<Dialog aria-label="New operator" layout="sectioned">
				<DialogHeader>
					<h2 className="font-semibold text-fg text-lg">New operator</h2>
				</DialogHeader>
				<Form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
					<DialogBody>
						<Input
							autoFocus
							description="Letters, digits, dot, dash or underscore. 3–64 characters."
							label="Username"
							name="username"
							required
						/>
						<Input
							description="At least 12 characters. They must change it on first sign in."
							label="Temporary password"
							name="password"
							required
							type="password"
						/>
						<Select
							description={role ? ROLE_SUMMARY[role] : undefined}
							label="Role"
							name="role"
							onValueChange={(key) => setRole(key as Role)}
							placeholder="Choose a role"
							required
							value={role}
						>
							{ROLES.map((value) => (
								<SelectItem key={value} value={value}>
									{value}
								</SelectItem>
							))}
						</Select>
						{error ? <ErrorNote>{error}</ErrorNote> : null}
					</DialogBody>
					<DialogFooter>
						<Button onClick={onClose} type="button" variant="secondary">
							Cancel
						</Button>
						<Button disabled={pending} type="submit">
							{pending ? "Creating…" : "Create user"}
						</Button>
					</DialogFooter>
				</Form>
			</Dialog>
		</Modal>
	);
}
