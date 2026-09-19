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
		if (runs.length && scroll.current) {
			scroll.current.scrollTop = scroll.current.scrollHeight;
		}
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
		const run: EmbeddingRun = {
			id: crypto.randomUUID(),
			inputs,
			model: model.id,
			settings,
			state: "running",
			vectors: [],
		};
		setRuns((current) => [...current, run]);
		setDraft("");
		await execute(run);
	}

	/**
	 * Runs a batch in its own place in the transcript: asking for the same lines again replaces that
	 * run rather than adding one, the way regenerating an answer does in the chat.
	 */
	async function execute(run: EmbeddingRun) {
		const { id } = run;
		// Under whatever is set now, not what was set then: the same rule the chat's regenerate follows.
		update(id, {
			state: "running",
			vectors: [],
			error: undefined,
			model: model.id,
			settings,
		});
		const controller = new AbortController();
		request.current = controller;
		const started = performance.now();
		try {
			const response = await runEmbeddings(
				{ model: model.id, inputs: run.inputs, settings },
				{ signal: controller.signal },
			);
			if (!alive.current) {
				return;
			}
			update(id, {
				state: "completed",
				vectors: vectorsFrom(response),
				durationMs: performance.now() - started,
				...(response.usage?.prompt_tokens === undefined
					? {}
					: { promptTokens: response.usage.prompt_tokens }),
				...(response.usage?.total_tokens === undefined
					? {}
					: { totalTokens: response.usage.total_tokens }),
			});
		} catch (cause) {
			if (!alive.current) {
				return;
			}
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
			empty={runs.length === 0}
			scroll={scroll}
			{...(localError ? { error: localError } : {})}
			composer={
				<>
					<Composer
						accepted={[]}
						busy={busy}
						files={[]}
						modelPicker={
							<ModelSelect
								capability="embedding"
								modelId={model.id}
								models={models}
								onSelect={onSelect}
							/>
						}
						onFiles={() => {
							/* intentionally empty */
						}}
						onPrompt={setDraft}
						onRemove={() => {
							/* intentionally empty */
						}}
						onReset={() => {
							request.current?.abort();
							setRuns([]);
							setDraft("");
							setLocalError(undefined);
						}}
						onSend={send}
						onSettings={() => setSettingsOpen(true)}
						onStop={() => request.current?.abort()}
						placeholder="One text per line..."
						prompt={draft}
						reading={false}
						showAttach={false}
					/>
					{notice ? (
						<p className="sr-only" role="status">
							{notice}
						</p>
					) : null}
				</>
			}
			transcript={runs.map((run) => (
				<EmbeddingRunView
					key={run.id}
					onCopy={copy}
					onRetry={() => {
						if (!busy) {
							void execute(run);
						}
					}}
					run={run}
				/>
			))}
		>
			<DialogRoot onOpenChange={setSettingsOpen} open={settingsOpen}>
				<DialogContent className="md:w-lg" layout="sectioned">
					<DialogHeader>
						<DialogTitle>Embedding settings</DialogTitle>
						<DialogDescription>
							Anything left on Default is not sent, so the model applies its
							own.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<NumberField.Root
							max={8192}
							min={1}
							onValueChange={(value) =>
								setSettings((current) => {
									const next = { ...current };
									if (value === null) {
										delete next.dimensions;
									} else {
										next.dimensions = value;
									}
									return next;
								})
							}
							step={1}
							value={settings.dimensions ?? null}
						>
							<NumberField.ScrubArea>
								<label
									className="font-medium text-sm"
									htmlFor="playground-embedding-dimensions"
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
							description="base64 is the same vector, a quarter of the bytes; it is decoded here either way."
							label="Encoding format"
							onValueChange={(value) =>
								setSettings((current) => {
									const next = { ...current };
									if (value === "default" || value === null) {
										delete next.encodingFormat;
									} else {
										next.encodingFormat = value;
									}
									return next;
								})
							}
							value={settings.encodingFormat ?? "default"}
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
