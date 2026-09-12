"use client";

import { Select, SelectItem } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { saveInstanceAction } from "./actions.ts";
import type { InstanceInput } from "./common.ts";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";
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

export interface InstanceDraft {
	id: string;
	definition: string;
	enabled: boolean;
	critical: boolean;
	priority: number;
	match: string;
	config: string;
}

function parseJson(
	raw: string,
	field: string,
): Record<string, unknown> | undefined {
	const text = raw.trim();
	if (text === "") return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`${field} is not valid JSON.`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error(`${field} must be a JSON object.`);
	return parsed as Record<string, unknown>;
}

/**
 * Binds one uploaded definition to one running configuration.
 *
 * `match` and `config` are free-form JSON because the definition owns their shape — it declares its
 * own schemas and the gateway validates against them. A generic key/value editor here would only
 * invent a second, weaker contract on top.
 */
export function InstanceDialog({
	draft,
	definitions,
	onClose,
	onSaved,
}: {
	draft: InstanceDraft | null;
	definitions: string[];
	onClose: () => void;
	onSaved: () => Promise<void> | void;
}) {
	const editing = draft?.id !== "" && draft !== null && draft.definition !== "";
	const [definition, setDefinition] = useState(draft?.definition ?? "");
	const [enabled, setEnabled] = useState(draft?.enabled ?? true);
	const [critical, setCritical] = useState(draft?.critical ?? false);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	// The dialog is mounted fresh per open (keyed by the caller), so state initialises from the draft.

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!draft) return;
		setError(null);
		setPending(true);
		const form = new FormData(event.currentTarget);
		try {
			const match = parseJson(String(form.get("match") ?? ""), "Match");
			const config = parseJson(String(form.get("config") ?? ""), "Config");
			const priority = Number(form.get("priority") ?? 0);
			const body: Omit<InstanceInput, "id"> = {
				definition,
				enabled,
				critical,
				priority,
				...(match ? { match } : {}),
				...(config ? { config } : {}),
			};
			const result = await saveInstanceAction(
				{ id: String(form.get("id") ?? "").trim(), ...body },
				draft.id && editing ? draft.id : undefined,
			);
			if (!result.ok) {
				setError(result.message);
				return;
			}
			await onSaved();
			onClose();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not save the instance.",
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<Modal isOpen={draft !== null} onOpenChange={(open) => !open && onClose()}>
			<Dialog layout="sectioned" aria-label="Extension instance">
				<DialogHeader>
					<h2 className="font-semibold text-fg text-lg">
						{editing ? "Edit instance" : "New instance"}
					</h2>
					<p className="pt-2 text-fg-muted text-sm">
						An instance is one definition, running with one configuration. The
						same definition can run several times with different matches.
					</p>
				</DialogHeader>

				<Form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
					<DialogBody>
						{editing ? null : (
							<Input
								name="id"
								label="Instance id"
								description="Stable name you will see in logs and in the reset action."
								placeholder="example-default"
								defaultValue={draft?.id ?? ""}
								required
								autoFocus
							/>
						)}
						<Select
							label="Definition"
							description="An uploaded artifact. Upload the code first if the list is empty."
							value={definition}
							onValueChange={(key) => setDefinition(String(key))}
						>
							{definitions.map((key) => (
								<SelectItem key={key} value={key}>
									{key}
								</SelectItem>
							))}
						</Select>
						<Input
							name="priority"
							type="number"
							label="Priority"
							description="Lower runs first when several instances handle the same hook."
							defaultValue={String(draft?.priority ?? 0)}
						/>
						<Textarea
							name="match"
							label="Match (JSON)"
							description="Narrows which requests reach this instance. Empty means every request."
							placeholder='{ "publicModel": "gpt-5.6-luna" }'
							rows={3}
							defaultValue={draft?.match ?? ""}
						/>
						<Textarea
							name="config"
							label="Config (JSON)"
							description="Validated against the schema the definition declares."
							rows={5}
							defaultValue={draft?.config ?? ""}
						/>

						<div className="flex flex-col gap-3 pt-1">
							<Switch checked={enabled} onCheckedChange={setEnabled}>
								Enabled
							</Switch>
							<div className="flex flex-col gap-1">
								<Switch checked={critical} onCheckedChange={setCritical}>
									Critical
								</Switch>
								<p className="max-w-xl text-fg-muted text-xs">
									A critical instance failing takes the request down with it. A
									non-critical one is skipped after repeated failures and the
									request continues without it.
								</p>
							</div>
						</div>

						{error ? <ErrorNote>{error}</ErrorNote> : null}
					</DialogBody>
					<DialogFooter>
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={pending || definition === ""}>
							{pending ? "Saving…" : "Save instance"}
						</Button>
					</DialogFooter>
				</Form>
			</Dialog>
		</Modal>
	);
}
