"use client";

import type { ModelChoice, PlaygroundModel } from "./models";
import { Select, SelectItem } from "#/components/ui/select";
import { NumberField } from "#/components/ui/number-field";
import { buttonStyles } from "#/components/ui/button";
import { EmbeddingRunView } from "./EmbeddingRunView";
import { useEffect, useRef, useState } from "react";
import { ModelSelect } from "./ModelSelect";
import { Workspace } from "./Workspace";
import { Composer } from "./Composer";

import {
	DialogDescription,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogClose,
	DialogTitle,
	DialogBody,
	DialogRoot,
} from "#/components/ui/dialog";

import {
	type EmbeddingSettings,
	emptyEmbeddingSettings,
	type EmbeddingRun,
	ENCODING_FORMATS,
	runEmbeddings,
	vectorsFrom,
} from "./embeddings";

/** One text per line, which is also how a batch is written into the box. */
export function inputsFrom(draft: string): string[] {
	return draft
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * Embeddings, as a batch of lines.
 *
 * The interesting request is rarely one text — it is several, compared — so a line is an input and
 * the run reports how alike the model considers them. Nothing about that needs a second screen.
 */
export function EmbeddingWorkspace({
	model,
	models,
	onSelect,
}: {
	model: PlaygroundModel;
	models: PlaygroundModel[];
	onSelect: (choice: ModelChoice) => void;
}) {
	const [settings, setSettings] = useState<EmbeddingSettings>(
		emptyEmbeddingSettings,
	);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const [runs, setRuns] = useState<EmbeddingRun[]>([]);
	const [localError, setLocalError] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const request = useRef<AbortController | null>(null);
	const alive = useRef(true);
	const scroll = useRef<HTMLDivElement>(null);
	const busy = runs.some((run) => run.state === "running");

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			request.current?.abort();
		};
	}, []);

	useEffect(() => {
		if (runs.length && scroll.current)
			scroll.current.scrollTop = scroll.current.scrollHeight;
	}, [runs]);

	function update(id: string, patch: Partial<EmbeddingRun>) {
		setRuns((current) =>
			current.map((run) => (run.id === id ? { ...run, ...patch } : run)),
		);
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setNotice("Copied to clipboard.");
		} catch (cause) {
			setLocalError(
				cause instanceof Error ? cause.message : "Could not copy the vector.",
			);
			throw cause;
		}
	}

	async function send(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) {
			setLocalError("Wait for the current batch to finish.");
			return;
		}
		const inputs = inputsFrom(draft);
		if (!inputs.length) {
			setLocalError("Enter at least one line to embed.");
			return;
		}
		setLocalError(undefined);
		setNotice(undefined);
		const id = crypto.randomUUID();
		setRuns((current) => [
			...current,
			{
				id,
				inputs,
				model: model.id,
				settings,
				state: "running",
				vectors: [],
			},
		]);
		setDraft("");
		const controller = new AbortController();
		request.current = controller;
		const started = performance.now();
		try {
			const response = await runEmbeddings(
				{ model: model.id, inputs, settings },
				{ signal: controller.signal },
			);
			if (!alive.current) return;
			update(id, {
				state: "completed",
				vectors: vectorsFrom(response),
				durationMs: performance.now() - started,
				...(response.usage?.prompt_tokens !== undefined
					? { promptTokens: response.usage.prompt_tokens }
					: {}),
				...(response.usage?.total_tokens !== undefined
					? { totalTokens: response.usage.total_tokens }
					: {}),
			});
		} catch (cause) {
			if (!alive.current) return;
			const stopped = cause instanceof Error && cause.name === "AbortError";
			update(id, {
				state: stopped ? "stopped" : "failed",
				durationMs: performance.now() - started,
				...(stopped
					? {}
					: {
							error:
								cause instanceof Error
									? cause.message
									: "The embedding request failed.",
						}),
			});
		} finally {
			request.current = null;
		}
	}

	return (
		<Workspace
			scroll={scroll}
			empty={runs.length === 0}
			{...(localError ? { error: localError } : {})}
			transcript={runs.map((run) => (
				<EmbeddingRunView
					key={run.id}
					run={run}
					onCopy={copy}
					onRetry={() => setDraft(run.inputs.join("\n"))}
				/>
			))}
			composer={
				<>
					<Composer
						prompt={draft}
						onPrompt={setDraft}
						files={[]}
						onRemove={() => {}}
						onFiles={() => {}}
						placeholder="One text per line..."
						showAttach={false}
						accepted={[]}
						reading={false}
						busy={busy}
						onSend={send}
						onStop={() => request.current?.abort()}
						onSettings={() => setSettingsOpen(true)}
						onReset={() => {
							request.current?.abort();
							setRuns([]);
							setDraft("");
							setLocalError(undefined);
						}}
						modelPicker={
							<ModelSelect
								models={models}
								capability="embedding"
								modelId={model.id}
								onSelect={onSelect}
							/>
						}
					/>
					{notice ? (
						<p role="status" className="sr-only">
							{notice}
						</p>
					) : null}
				</>
			}
		>
			<DialogRoot open={settingsOpen} onOpenChange={setSettingsOpen}>
				<DialogContent layout="sectioned" className="md:w-lg">
					<DialogHeader>
						<DialogTitle>Embedding settings</DialogTitle>
						<DialogDescription>
							Anything left on Default is not sent, so the model applies its
							own.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<NumberField.Root
							value={settings.dimensions ?? null}
							onValueChange={(value) =>
								setSettings((current) => {
									const next = { ...current };
									if (value === null) delete next.dimensions;
									else next.dimensions = value;
									return next;
								})
							}
							min={1}
							max={8192}
							step={1}
						>
							<NumberField.ScrubArea>
								<label
									htmlFor="playground-embedding-dimensions"
									className="font-medium text-sm"
								>
									Dimensions
								</label>
							</NumberField.ScrubArea>
							<NumberField.Group>
								<NumberField.Decrement aria-label="Fewer dimensions" />
								<NumberField.Input
									id="playground-embedding-dimensions"
									placeholder="Default"
								/>
								<NumberField.Increment aria-label="More dimensions" />
							</NumberField.Group>
							<p className="text-fg-muted text-xs">
								Only models that support shortening accept this.
							</p>
						</NumberField.Root>
						<Select
							label="Encoding format"
							description="base64 is the same vector, a quarter of the bytes; it is decoded here either way."
							value={settings.encodingFormat ?? "default"}
							onValueChange={(value) =>
								setSettings((current) => {
									const next = { ...current };
									if (value === "default" || value === null)
										delete next.encodingFormat;
									else next.encodingFormat = value;
									return next;
								})
							}
						>
							<SelectItem value="default">Default</SelectItem>
							{ENCODING_FORMATS.map((format) => (
								<SelectItem key={format} value={format}>
									{format}
								</SelectItem>
							))}
						</Select>
					</DialogBody>
					<DialogFooter>
						<DialogClose
							className={buttonStyles({ variant: "primary", size: "sm" })}
						>
							Done
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</DialogRoot>
		</Workspace>
	);
}
