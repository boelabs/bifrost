"use client";

import type { ModelChoice, PlaygroundModel } from "./models";
import { Select, SelectItem } from "#/components/ui/select";
import { VideoSettingsDialog } from "./VideoSettings";
import { useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { VideoRunView } from "./VideoRunView";
import { IconX } from "@tabler/icons-react";
import { ModelSelect } from "./ModelSelect";
import { Workspace } from "./Workspace";
import { Composer } from "./Composer";

import {
	type VideoReference,
	type ReferenceRole,
	type VideoSettings,
	referenceRejection,
	emptyVideoSettings,
	REFERENCE_TYPES,
	type VideoRun,
	type VideoJob,
	taskConflict,
	createVideo,
	pollVideo,
} from "./videos";

/** A chosen file becomes a reference only once it is readable as the data URL the request carries. */
function readReference(file: File): Promise<VideoReference> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(reader.error ?? new Error(`Could not read ${file.name}.`));
		reader.onabort = () =>
			reject(new Error(`Reading ${file.name} was cancelled.`));
		reader.onload = () => {
			if (typeof reader.result !== "string") {
				reject(new Error(`Could not read ${file.name}.`));
				return;
			}
			resolve({
				id: crypto.randomUUID(),
				filename: file.name,
				mediaType: file.type,
				url: reader.result,
				role: "reference",
			});
		};
		reader.readAsDataURL(file);
	});
}

/**
 * The attachments, with what each one is for.
 *
 * An image can guide the whole video or pin its first or last frame, and those are different fields
 * on the wire — so the choice is made on the chip, beside the picture it applies to, rather than in
 * a settings panel that cannot show which image is meant. A video reference has no frame to be.
 */
function References({
	references,
	onRole,
	onRemove,
	disabled,
}: {
	references: VideoReference[];
	onRole: (id: string, role: ReferenceRole) => void;
	onRemove: (id: string) => void;
	disabled: boolean;
}) {
	return (
		<ul className="mb-2 flex gap-2 overflow-x-auto rounded-[28px] border border-border bg-surface-2 p-2 max-sm:rounded-2xl">
			{references.map((reference) => {
				const image = reference.mediaType.startsWith("image/");
				return (
					<li
						className="flex shrink-0 items-center gap-2 rounded-2xl bg-surface p-2"
						key={reference.id}
					>
						{image ? (
							// biome-ignore lint/performance/noImgElement: a data: URL, which next/image cannot optimise
							<img
								alt={reference.filename}
								className="size-11 rounded-lg object-cover"
								src={reference.url}
							/>
						) : (
							<video
								className="size-11 rounded-lg bg-surface-2 object-cover"
								muted
								preload="metadata"
								src={reference.url}
							/>
						)}
						<div className="flex min-w-0 flex-col gap-1">
							<span
								className="max-w-36 truncate text-xs"
								title={reference.filename}
							>
								{reference.filename}
							</span>
							{image ? (
								<Select
									aria-label={`What ${reference.filename} is for`}
									disabled={disabled}
									onValueChange={(value) => {
										if (value) {
											onRole(reference.id, value as ReferenceRole);
										}
									}}
									size="xs"
									value={reference.role}
									variant="ghost"
								>
									<SelectItem value="reference">Reference</SelectItem>
									<SelectItem value="first_frame">First frame</SelectItem>
									<SelectItem value="last_frame">Last frame</SelectItem>
								</Select>
							) : (
								<span className="px-1 text-[11px] text-fg-muted">
									Reference
								</span>
							)}
						</div>
						<Button
							aria-label={`Remove ${reference.filename}`}
							disabled={disabled}
							mode="icon"
							onClick={() => onRemove(reference.id)}
							size="sm"
							title="Remove"
							type="button"
							variant="ghost"
						>
							<IconX aria-hidden className="size-4" />
						</Button>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * Video generation, as a session rather than a form.
 *
 * Unlike every other capability here, the gateway answers a request with a job and the video itself
 * arrives minutes later — so a run is watched rather than awaited. Stopping stops the watching, not
 * the provider: the run keeps its job id and says so, and "Check again" picks it back up. That is
 * the honest reading of an asynchronous endpoint, and it is also the useful one, because a lost
 * connection no longer loses the video.
 */
export function VideoWorkspace({
	model,
	models,
	onSelect,
}: {
	model: PlaygroundModel;
	models: PlaygroundModel[];
	onSelect: (choice: ModelChoice) => void;
}) {
	const [settings, setSettings] = useState<VideoSettings>(emptyVideoSettings);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [references, setReferences] = useState<VideoReference[]>([]);
	const [runs, setRuns] = useState<VideoRun[]>([]);
	const [reading, setReading] = useState(false);
	const [localError, setLocalError] = useState<string>();
	/** One controller per watched run, so a rerun cancels only its own. */
	const watching = useRef(new Map<string, AbortController>());
	const alive = useRef(true);
	const scroll = useRef<HTMLDivElement>(null);
	const busy = runs.some((run) => run.state === "running");

	useEffect(() => {
		const controllers = watching.current;
		alive.current = true;
		return () => {
			alive.current = false;
			// Leaving the capability stops every watch; the jobs themselves carry on upstream.
			for (const controller of controllers.values()) {
				controller.abort();
			}
			controllers.clear();
		};
	}, []);

	useEffect(() => {
		if (runs.length && scroll.current) {
			scroll.current.scrollTop = scroll.current.scrollHeight;
		}
	}, [runs]);

	function update(id: string, patch: Partial<VideoRun>) {
		setRuns((current) =>
			current.map((run) => (run.id === id ? { ...run, ...patch } : run)),
		);
	}

	function stopAll() {
		for (const controller of watching.current.values()) {
			controller.abort();
		}
	}

	async function addFiles(selected: File[]) {
		setLocalError(undefined);
		const rejection = selected.map(referenceRejection).find(Boolean);
		if (rejection) {
			setLocalError(rejection);
			return;
		}
		setReading(true);
		try {
			const added = await Promise.all(selected.map(readReference));
			if (!alive.current) {
				return;
			}
			setReferences((current) => [...current, ...added]);
		} catch (cause) {
			if (alive.current) {
				setLocalError(
					cause instanceof Error ? cause.message : "Could not read the file.",
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
			setLocalError("Wait for the current video before starting another.");
			return;
		}
		if (!prompt.trim()) {
			setLocalError("Describe the video you want.");
			return;
		}
		const conflict = taskConflict(settings.task, references);
		if (conflict) {
			setLocalError(conflict);
			return;
		}
		setLocalError(undefined);
		const run: VideoRun = {
			id: crypto.randomUUID(),
			prompt: prompt.trim(),
			references,
			model: model.id,
			settings,
			state: "running",
		};
		setRuns((current) => [...current, run]);
		setPrompt("");
		setReferences([]);
		await execute(run);
	}

	/**
	 * Runs a generation in its own place in the transcript.
	 *
	 * Asking for the same thing again replaces that run rather than adding one, the way regenerating
	 * an answer does in the chat. Passing `existing` resumes a job that is already out there instead
	 * of starting a second one — the same code path, because watching is the longer half either way.
	 */
	async function execute(run: VideoRun, existing?: VideoJob) {
		const { id } = run;
		watching.current.get(id)?.abort();
		const controller = new AbortController();
		watching.current.set(id, controller);
		const started = performance.now();
		// Under whatever is set now, not what was set then: the same rule the chat's regenerate
		// follows. A resumed run is the job it already has, so its settings stand.
		update(
			id,
			existing
				? { state: "running", error: undefined }
				: {
						state: "running",
						job: undefined,
						error: undefined,
						durationMs: undefined,
						model: model.id,
						settings,
					},
		);
		try {
			const job =
				existing ??
				(await createVideo(
					{
						model: model.id,
						prompt: run.prompt,
						settings,
						references: run.references,
					},
					{ signal: controller.signal },
				));
			if (!alive.current) {
				return;
			}
			if (!existing) {
				update(id, { job });
			}
			const final = await pollVideo(job, {
				signal: controller.signal,
				onUpdate: (next) => {
					if (alive.current) {
						update(id, { job: next });
					}
				},
			});
			if (!alive.current) {
				return;
			}
			update(id, {
				state: final.status === "failed" ? "failed" : "completed",
				job: final,
				durationMs: performance.now() - started,
				...(final.status === "failed"
					? { error: final.error?.message ?? "The video generation failed." }
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
									: "The video request failed.",
						}),
			});
		} finally {
			if (watching.current.get(id) === controller) {
				watching.current.delete(id);
			}
		}
	}

	return (
		<Workspace
			empty={runs.length === 0}
			scroll={scroll}
			{...(localError ? { error: localError } : {})}
			composer={
				<>
					{references.length ? (
						<References
							disabled={busy}
							onRemove={(id) =>
								setReferences((current) =>
									current.filter((reference) => reference.id !== id),
								)
							}
							onRole={(id, role) =>
								setReferences((current) =>
									current.map((reference) =>
										reference.id === id ? { ...reference, role } : reference,
									),
								)
							}
							references={references}
						/>
					) : null}
					<Composer
						accepted={REFERENCE_TYPES}
						busy={busy}
						files={[]}
						modelPicker={
							<ModelSelect
								capability="video"
								modelId={model.id}
								models={models}
								onSelect={onSelect}
							/>
						}
						onFiles={(selected) => {
							void addFiles(selected);
						}}
						onPrompt={setPrompt}
						onRemove={() => {}}
						onReset={() => {
							stopAll();
							setRuns([]);
							setReferences([]);
							setPrompt("");
							setLocalError(undefined);
						}}
						onSend={send}
						onSettings={() => setSettingsOpen(true)}
						onStop={stopAll}
						placeholder="Describe a video, or attach an image to start from..."
						prompt={prompt}
						reading={reading}
					/>
				</>
			}
			transcript={runs.map((run) => (
				<VideoRunView
					key={run.id}
					onCheck={() => {
						if (!busy && run.job) {
							void execute(run, run.job);
						}
					}}
					onRetry={() => {
						if (!busy) {
							void execute(run);
						}
					}}
					run={run}
				/>
			))}
		>
			<VideoSettingsDialog
				onOpenChange={setSettingsOpen}
				onSettings={setSettings}
				open={settingsOpen}
				settings={settings}
			/>
		</Workspace>
	);
}
