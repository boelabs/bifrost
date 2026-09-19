"use client";

import { saveFallbackAction } from "./actions.ts";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { FALLBACK_KINDS } from "./common.ts";
import { Form } from "#/components/ui/form";
import { useState } from "react";

import {
	DialogHeader,
	DialogFooter,
	DialogBody,
	Dialog,
	Modal,
} from "#/components/ui/modal";

import {
	ModelListInput,
	ModelInput,
} from "#/shared/components/ModelPicker.tsx";

/**
 * A chain is keyed by (primaryModel, reason), so saving an existing pair replaces it — the gateway's
 * PUT is an upsert.
 *
 * The reason arrives as a prop rather than a dropdown inside the form: the operator opened this from
 * a named list and has already answered that question. Asking again, in the gateway's vocabulary,
 * only invites picking the wrong one.
 */
export function FallbackDialog({
	reason,
	models,
	onClose,
	onSaved,
}: {
	reason: (typeof FALLBACK_KINDS)[number]["reason"] | null;
	models: readonly string[];
	onClose: () => void;
	onSaved: () => Promise<void> | void;
}) {
	const [primaryModel, setPrimaryModel] = useState("");
	const [chain, setChain] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const kind = FALLBACK_KINDS.find((entry) => entry.reason === reason);

	function close() {
		setPrimaryModel("");
		setChain([]);
		setError(null);
		onClose();
	}

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!reason) {
			return;
		}
		if (chain.length === 0) {
			setError("A chain needs at least one fallback model.");
			return;
		}
		if (chain.includes(primaryModel.trim())) {
			setError("The primary model cannot also be its own fallback.");
			return;
		}
		setError(null);
		setPending(true);
		try {
			const result = await saveFallbackAction({
				primaryModel: primaryModel.trim(),
				fallbackModels: chain,
				reason,
			});
			if (!result.ok) {
				setError(result.message);
				return;
			}
			await onSaved();
			close();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not save the chain.",
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<Modal isOpen={reason !== null} onOpenChange={(open) => !open && close()}>
			<Dialog aria-label="Fallback chain" layout="sectioned">
				<DialogHeader>
					<h2 className="font-semibold text-fg text-lg">
						{kind?.title ?? "Fallback chain"}
					</h2>
					<p className="pt-2 text-fg-muted text-sm">
						{kind?.description} Saving over an existing primary model replaces
						its chain for this case.
					</p>
				</DialogHeader>

				<Form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
					<DialogBody>
						<ModelInput
							autoFocus
							description="The model whose failures trigger this chain. It must already have at least one deployment."
							label="Primary public model"
							models={models}
							onChange={setPrimaryModel}
							required
							value={primaryModel}
						/>
						<ModelListInput
							description="Tried in the order shown, left to right. One to five models, each sharing an executable operation with the primary."
							emptyHint="Press Enter to add this model to the chain."
							label="Fallback chain"
							models={models.filter((model) => model !== primaryModel.trim())}
							onChange={setChain}
							placeholder="Pick or type a model"
							value={chain}
						/>

						{error ? <ErrorNote>{error}</ErrorNote> : null}
					</DialogBody>
					<DialogFooter>
						<Button onClick={close} type="button" variant="secondary">
							Cancel
						</Button>
						<Button disabled={pending} type="submit">
							{pending ? "Saving…" : "Save chain"}
						</Button>
					</DialogFooter>
				</Form>
			</Dialog>
		</Modal>
	);
}
