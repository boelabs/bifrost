"use client";

import type { ModelChoice, PlaygroundModel } from "./models";
import { ImageSettingsDialog } from "./ImageSettings";
import { useEffect, useRef, useState } from "react";
import { readAttachments } from "./attachments";
import { ImageRunView } from "./ImageRunView";
import { ModelSelect } from "./ModelSelect";
import { IMAGE_EDIT } from "./capabilities";
import { Workspace } from "./Workspace";
import { Composer } from "./Composer";

import {
	type ImageSettings,
	emptyImageSettings,
	type ImageRun,
	imagesFrom,
	runImages,
} from "./images";

/** What the edit endpoint accepts as a source. */
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

/**
 * A source image kept twice over: as the data URL the composer previews, and as the original file,
 * which is what an edit is actually sent as.
 */
interface SourceImage {
	type: "file";
	id: string;
	filename?: string;
	mediaType: string;
	url: string;
	file: File;
}

/**
 * Image generation, as a session rather than a form.
 *
 * Runs stay on screen in the order they were made, because comparing two prompts — or the same
 * prompt at two sizes — is the reason to open this at all. Attaching a source turns the next run
 * into an edit, so there is no mode to find: a model that cannot edit simply never offers the clip.
 */
export function ImageWorkspace({
	model,
	models,
	onSelect,
}: {
	model: PlaygroundModel;
	models: PlaygroundModel[];
	onSelect: (choice: ModelChoice) => void;
}) {
	const [settings, setSettings] = useState<ImageSettings>(emptyImageSettings);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [sources, setSources] = useState<SourceImage[]>([]);
	const [runs, setRuns] = useState<ImageRun[]>([]);
	const [reading, setReading] = useState(false);
	const [localError, setLocalError] = useState<string>();
	const request = useRef<AbortController | null>(null);
	const alive = useRef(true);
	const scroll = useRef<HTMLDivElement>(null);
	const canEdit = model.operations.includes(IMAGE_EDIT);
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

	function update(id: string, patch: Partial<ImageRun>) {
		setRuns((current) =>
			current.map((run) => (run.id === id ? { ...run, ...patch } : run)),
		);
	}

	async function addFiles(selected: File[]) {
		setLocalError(undefined);
		setReading(true);
		try {
			const parts = await readAttachments(selected, ACCEPTED);
			if (!alive.current) {
				return;
			}
			setSources((current) => [
				...current,
				...parts.flatMap((part, index) => {
					const file = selected[index];
					return file
						? [{ ...part, id: crypto.randomUUID(), file }]
						: ([] as SourceImage[]);
				}),
			]);
		} catch (cause) {
			if (alive.current) {
				setLocalError(
					cause instanceof Error ? cause.message : "Could not read the image.",
				);
			}
		} finally {
			if (alive.current) {
				setReading(false);
			}
		}
	}

	async function send(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || reading) {
			setLocalError("Wait for the current run before starting another.");
			return;
		}
		if (!prompt.trim()) {
			setLocalError("Describe the image you want.");
			return;
		}
		setLocalError(undefined);
		const run: ImageRun = {
			id: crypto.randomUUID(),
			prompt: prompt.trim(),
			sources: sources.map((source) => source.url),
			files: sources.map((source) => source.file),
			model: model.id,
			settings,
			state: "running",
			images: [],
		};
		setRuns((current) => [...current, run]);
		setPrompt("");
		setSources([]);
		await execute(run);
	}

	/**
	 * Runs a turn, in its own place in the transcript.
	 *
	 * Asking for the same thing again replaces that run rather than adding one: a second attempt at
	 * one prompt is the same turn, the way regenerating an answer is in the chat.
	 */
	async function execute(run: ImageRun) {
		const { id } = run;
		// Under whatever is set now, not what was set then: the same rule the chat's regenerate follows.
		update(id, {
			state: "running",
			images: [],
			error: undefined,
			model: model.id,
			settings,
		});
		const controller = new AbortController();
		request.current = controller;
		const started = performance.now();
		try {
			const response = await runImages(
				{ model: model.id, prompt: run.prompt, files: run.files, settings },
				{ signal: controller.signal },
			);
			if (!alive.current) {
				return;
			}
			const revised = response.data[0]?.revised_prompt;
			update(id, {
				state: "completed",
				images: imagesFrom(response),
				durationMs: performance.now() - started,
				...(revised ? { revisedPrompt: revised } : {}),
				...(response.usage
					? {
							usage: {
								...(response.usage.input_tokens === undefined
									? {}
									: { inputTokens: response.usage.input_tokens }),
								...(response.usage.output_tokens === undefined
									? {}
									: { outputTokens: response.usage.output_tokens }),
								...(response.usage.total_tokens === undefined
									? {}
									: { totalTokens: response.usage.total_tokens }),
							},
						}
					: {}),
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
									: "The image request failed.",
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
				<Composer
					accepted={canEdit ? ACCEPTED : []}
					busy={busy}
					files={sources}
					modelPicker={
						<ModelSelect
							capability="image"
							modelId={model.id}
							models={models}
							onSelect={onSelect}
						/>
					}
					onFiles={(selected) => {
						void addFiles(selected);
					}}
					onPrompt={setPrompt}
					onRemove={(id) =>
						setSources((current) =>
							current.filter((source) => source.id !== id),
						)
					}
					onReset={() => {
						request.current?.abort();
						setRuns([]);
						setSources([]);
						setPrompt("");
						setLocalError(undefined);
					}}
					onSend={send}
					onSettings={() => setSettingsOpen(true)}
					onStop={() => request.current?.abort()}
					placeholder={
						canEdit
							? "Describe an image, or attach one to edit..."
							: "Describe an image..."
					}
					prompt={prompt}
					reading={reading}
				/>
			}
			transcript={runs.map((run) => (
				<ImageRunView
					key={run.id}
					onRetry={() => {
						if (!busy) {
							void execute(run);
						}
					}}
					run={run}
				/>
			))}
		>
			<ImageSettingsDialog
				canEdit={canEdit}
				onOpenChange={setSettingsOpen}
				onSettings={setSettings}
				open={settingsOpen}
				settings={settings}
			/>
		</Workspace>
	);
}
