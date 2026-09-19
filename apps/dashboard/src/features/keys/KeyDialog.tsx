"use client";

import { type KeyDraft, draftFromKey, EMPTY_DRAFT } from "./draft.ts";
import { ModelListInput } from "#/shared/components/ModelPicker.tsx";
import { Select, SelectItem } from "#/components/ui/select";
import { type VirtualKey, formatCents } from "./common.ts";
import { ErrorNote } from "#/components/ui/page";
import { Switch } from "#/components/ui/switch";
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

const RESET_PERIODS = ["hourly", "daily", "weekly", "monthly"] as const;
const NO_RESET = "never";

/**
 * One form for issuing a key and for editing one.
 *
 * They were never two different questions — a budget, a rate limit and a scope are the same
 * decisions on day one and on day ninety — and splitting them is how a dashboard ends up able to
 * create a key it cannot afterwards correct.
 */
export function KeyDialog({
	existing,
	models,
	isOpen,
	pending,
	onClose,
	onSubmit,
	onResetSpend,
}: {
	existing?: VirtualKey;
	models: readonly string[];
	isOpen: boolean;
	pending: boolean;
	onClose: () => void;
	onSubmit: (draft: KeyDraft) => Promise<boolean>;
	onResetSpend?: () => void;
}) {
	const [draft, setDraft] = useState<KeyDraft>(() =>
		existing ? draftFromKey(existing) : EMPTY_DRAFT,
	);
	const [error, setError] = useState<string | null>(null);
	const editing = existing !== undefined;
	let submitLabel = "Create key";
	if (pending) {
		submitLabel = "Saving…";
	} else if (editing) {
		submitLabel = "Save changes";
	}

	function set<K extends keyof KeyDraft>(field: K, value: KeyDraft[K]) {
		setDraft((current) => ({ ...current, [field]: value }));
	}

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		if (draft.name.trim() === "") {
			setError("The key needs a name.");
			return;
		}
		if (await onSubmit(draft)) {
			onClose();
		}
	}

	return (
		<Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
			<Dialog
				aria-label={editing ? "Edit virtual key" : "New virtual key"}
				layout="sectioned"
				width="min(100%, 34rem)"
			>
				<DialogHeader>
					<h2 className="font-semibold text-fg text-lg">
						{editing ? `Edit ${existing.name}` : "New virtual key"}
					</h2>
					<p className="pt-2 text-fg-muted text-sm">
						{editing
							? "The secret never changes here — everything else about the key does."
							: "Scope the key to the models a client may call, and give it limits it cannot exceed."}
					</p>
				</DialogHeader>
				<Form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
					<DialogBody>
						<Input
							autoFocus={!editing}
							label="Name"
							onValueChange={(value) => set("name", value)}
							required
							value={draft.name}
						/>

						<ModelListInput
							description="Leave empty to allow every public model. Names that are not deployed yet are accepted."
							emptyHint="Press Enter to allow this model name."
							label="Allowed public models"
							models={models}
							onChange={(value) => set("allowedModels", value)}
							value={draft.allowedModels}
						/>

						<div className="grid gap-4 sm:grid-cols-2">
							<Input
								description="Empty means no ceiling."
								label="Budget (USD)"
								min={0}
								onValueChange={(value) => set("budget", value)}
								step="0.01"
								type="number"
								value={draft.budget}
							/>
							<Select
								description="Without a period the budget is a lifetime total."
								label="Budget resets"
								onValueChange={(value) =>
									set(
										"budgetReset",
										value === NO_RESET
											? ""
											: (value as (typeof RESET_PERIODS)[number]),
									)
								}
								value={draft.budgetReset === "" ? NO_RESET : draft.budgetReset}
							>
								<SelectItem value={NO_RESET}>never</SelectItem>
								{RESET_PERIODS.map((period) => (
									<SelectItem key={period} value={period}>
										{period}
									</SelectItem>
								))}
							</Select>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<Input
								label="Requests / minute"
								min={0}
								onValueChange={(value) => set("rpm", value)}
								type="number"
								value={draft.rpm}
							/>
							<Input
								label="Tokens / minute"
								min={0}
								onValueChange={(value) => set("tpm", value)}
								type="number"
								value={draft.tpm}
							/>
						</div>

						<Input
							description="In your timezone. Empty means the key never expires on its own."
							label="Expires"
							onValueChange={(value) => set("expiresAt", value)}
							type="datetime-local"
							value={draft.expiresAt}
						/>

						{editing ? (
							<div className="flex flex-col gap-4 rounded-xl border border-border/50 p-4">
								<Switch
									checked={draft.enabled}
									onCheckedChange={(checked) => set("enabled", checked)}
								>
									Enabled
								</Switch>
								<p className="text-fg-muted text-xs">
									A disabled key is refused at the door; its spend and history
									are kept.
								</p>
								{onResetSpend ? (
									<div className="flex flex-wrap items-center justify-between gap-3 border-border/50 border-t pt-3">
										<span className="text-fg-muted text-xs">
											Spent {formatCents(existing.spendCents)} in the current
											period.
										</span>
										<Button
											onClick={onResetSpend}
											size="sm"
											type="button"
											variant="secondary"
										>
											Reset spend
										</Button>
									</div>
								) : null}
							</div>
						) : null}

						{error ? <ErrorNote>{error}</ErrorNote> : null}
					</DialogBody>
					<DialogFooter>
						<Button onClick={onClose} type="button" variant="secondary">
							Cancel
						</Button>
						<Button disabled={pending} type="submit">
							{submitLabel}
						</Button>
					</DialogFooter>
				</Form>
			</Dialog>
		</Modal>
	);
}
