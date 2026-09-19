"use client";

import type { ModelChoice, PlaygroundModel } from "./models";
import { Select, SelectItem } from "#/components/ui/select";
import { NumberField } from "#/components/ui/number-field";
import { buttonStyles } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { useEffect, useRef, useState } from "react";
import { ResponseLoader } from "./ResponseLoader";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import { Input } from "#/components/ui/input";
import { ModelSelect } from "./ModelSelect";
import { Workspace } from "./Workspace";
import { Composer } from "./Composer";

import {
	type TranscriptionSettings,
	emptyTranscriptionSettings,
	TIMESTAMP_GRANULARITIES,
	type TranscriptionRun,
	type ResponseFormat,
	RESPONSE_FORMATS,
	runTranscription,
	AUDIO_TYPES,
	timestamp,
} from "./transcription";

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
	IconPlayerPlay,
	IconFileText,
	IconRotate2,
	IconX,
} from "@tabler/icons-react";

import {
	MESSAGE_ACTION_ICON,
	MESSAGE_ACTION,
	CopyAction,
} from "./MessageParts";

function duration(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function bytes(size: number): string {
	return size > 1024 * 1024
		? `${(size / (1024 * 1024)).toFixed(1)} MB`
		: `${Math.max(1, Math.round(size / 1024))} KB`;
}

/**
 * The file to be transcribed, once it is chosen.
 *
 * It replaces the composer's own input, because there is nothing to write: the audio is the
 * request. It plays where it sits, so the text below can be checked against what was said.
 */
function Chosen({
	file,
	url,
	onClear,
	disabled,
}: {
	file: File;
	url: string;
	onClear: () => void;
	disabled: boolean;
}) {
	return (
		<div className="mb-2 flex items-center gap-3 rounded-[28px] border border-border bg-surface-2 px-4 py-3 max-sm:rounded-2xl">
			<IconFileText aria-hidden className="size-5 shrink-0 text-fg-muted" />
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">{file.name}</p>
				<p className="text-fg-muted text-xs">
					{file.type || "audio"} · {bytes(file.size)}
				</p>
			</div>
			{/* biome-ignore lint/a11y/useMediaCaption: the captions are what this page is producing */}
			<audio className="h-9 max-w-56 shrink-0" controls src={url} />
			<Button
				aria-label="Remove the file"
				disabled={disabled}
				mode="icon"
				onClick={onClear}
				size="sm"
				title="Remove the file"
				type="button"
				variant="ghost"
			>
				<IconX aria-hidden className="size-4.5" />
			</Button>
		</div>
	);
}

/** Subtitle formats keep their line breaks and timings, so they are shown as source. */
function TranscriptText({
	text,
	subtitles,
}: {
	text: string;
	subtitles: boolean;
}) {
	if (subtitles) {
		return (
			<pre className="overflow-x-auto rounded-xl border border-border/50 bg-card p-3 font-mono text-xs leading-5">
				{text}
			</pre>
		);
	}
	return (
		<p className="whitespace-pre-wrap text-base leading-7 [overflow-wrap:anywhere]">
			{text}
		</p>
	);
}

function TranscriptionRunView({
	run,
	onCopy,
	onRetry,
}: {
	run: TranscriptionRun;
	onCopy: (text: string) => Promise<void>;
	onRetry: () => void;
}) {
	const subtitles =
		run.settings.responseFormat === "srt" ||
		run.settings.responseFormat === "vtt";
	return (
		<section
			aria-label="Transcription run"
			className="flex w-full flex-col gap-4 px-4 last:min-h-[calc(var(--transcript-height,0px)-3.5rem)]"
		>
			<article
				aria-label="You message"
				className="ml-auto flex w-full max-w-[90%] flex-col items-end gap-1"
			>
				<div className="flex items-center gap-3 rounded-3xl border border-border/60 bg-surface-2 px-3.5 py-2.5">
					<IconPlayerPlay
						aria-hidden
						className="size-4 shrink-0 text-fg-muted"
					/>
					<span className="truncate text-sm">{run.filename}</span>
				</div>
				{/* biome-ignore lint/a11y/useMediaCaption: the captions are what this page is producing */}
				<audio className="h-9 max-w-64" controls src={run.audio} />
			</article>
			<article
				aria-label="Assistant message"
				className="flex w-full min-w-0 flex-col gap-2"
			>
				{run.state === "running" ? <ResponseLoader /> : null}
				{run.state === "stopped" ? (
					<div className="text-fg-muted text-xs">
						<Status tone="muted">Stopped</Status>
					</div>
				) : null}
				{run.text ? (
					<TranscriptText subtitles={subtitles} text={run.text} />
				) : null}
				{run.segments.length ? (
					<ol className="flex flex-col gap-1">
						{run.segments.map((segment, index) => (
							<li
								className="flex gap-3 rounded-lg px-2 py-1 text-sm odd:bg-surface-2/60"
								// biome-ignore lint/suspicious/noArrayIndexKey: segments are a sequence, and their order is their identity
								key={index}
							>
								<span className="shrink-0 font-mono text-fg-muted text-xs leading-6">
									{segment.start === undefined ? "—" : timestamp(segment.start)}
								</span>
								<span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
									{segment.text}
								</span>
							</li>
						))}
					</ol>
				) : null}
				{run.error ? (
					<ErrorNote width="fit-content">{run.error}</ErrorNote>
				) : null}
				<div className="-ml-2 flex h-10 shrink-0 items-center gap-0.5 lg:h-8">
					<CopyAction
						disabled={!run.text}
						label="Copy transcript"
						onCopy={onCopy}
						text={run.text}
					/>
					<Button
						aria-label="Transcribe again"
						className={MESSAGE_ACTION}
						disabled={run.state === "running"}
						mode="icon"
						onClick={onRetry}
						size="sm"
						title="Transcribe again"
						type="button"
						variant="ghost"
					>
						<IconRotate2 aria-hidden className={MESSAGE_ACTION_ICON} />
					</Button>
					<p className="px-2 text-fg-muted text-xs">
						{[
							run.model,
							run.settings.responseFormat,
							run.language,
							run.audioDuration === undefined
								? undefined
								: `${run.audioDuration.toFixed(1)}s of audio`,
							run.durationMs === undefined
								? undefined
								: duration(run.durationMs),
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				</div>
			</article>
		</section>
	);
}

/**
 * Transcription: the one capability whose request is a file rather than something typed.
 *
 * So the composer's text box gives way to the chosen file, which plays where it sits — checking a
 * transcript against the audio is the whole job, and a player two screens away is no use for it.
 */
export function TranscriptionWorkspace({
	model,
	models,
	onSelect,
}: {
	model: PlaygroundModel;
	models: PlaygroundModel[];
	onSelect: (choice: ModelChoice) => void;
}) {
	const [settings, setSettings] = useState<TranscriptionSettings>(
		emptyTranscriptionSettings,
	);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [file, setFile] = useState<{ file: File; url: string } | null>(null);
	const [runs, setRuns] = useState<TranscriptionRun[]>([]);
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

	function update(id: string, patch: Partial<TranscriptionRun>) {
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
				cause instanceof Error
					? cause.message
					: "Could not copy the transcript.",
			);
			throw cause;
		}
	}

	function choose(selected: File[]) {
		const [first] = selected;
		if (!first) {
			return;
		}
		if (first.size === 0) {
			setLocalError(`${first.name}: the file is empty.`);
			return;
		}
		setLocalError(undefined);
		// One request, one file: a second choice replaces the first rather than queueing.
		setFile((current) => {
			if (current) {
				URL.revokeObjectURL(current.url);
			}
			return { file: first, url: URL.createObjectURL(first) };
		});
	}

	async function transcribe(chosen: { file: File; url: string }) {
		setLocalError(undefined);
		setNotice(undefined);
		const run: TranscriptionRun = {
			id: crypto.randomUUID(),
			filename: chosen.file.name,
			file: chosen.file,
			audio: chosen.url,
			mediaType: chosen.file.type,
			model: model.id,
			settings,
			state: "running",
			text: "",
			segments: [],
		};
		setRuns((current) => [...current, run]);
		// The run owns the object URL from here, so the picker can take another file.
		setFile((current) => (current === chosen ? null : current));
		await execute(run);
	}

	/**
	 * Transcribes in the run's own place in the transcript: the same audio again replaces that run
	 * rather than adding one, the way regenerating an answer does in the chat.
	 */
	async function execute(run: TranscriptionRun) {
		const { id } = run;
		// Under whatever is set now, not what was set then: the same rule the chat's regenerate follows.
		update(id, {
			state: "running",
			text: "",
			segments: [],
			error: undefined,
			model: model.id,
			settings,
		});
		const controller = new AbortController();
		request.current = controller;
		const started = performance.now();
		try {
			const transcription = await runTranscription(
				{ model: model.id, file: run.file, settings },
				{ signal: controller.signal },
			);
			if (!alive.current) {
				return;
			}
			update(id, {
				state: "completed",
				text: transcription.text,
				segments: transcription.segments,
				durationMs: performance.now() - started,
				...(transcription.language === undefined
					? {}
					: { language: transcription.language }),
				...(transcription.duration === undefined
					? {}
					: { audioDuration: transcription.duration }),
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
									: "The transcription failed.",
						}),
			});
		} finally {
			request.current = null;
		}
	}

	async function send(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) {
			setLocalError("Wait for the current transcription to finish.");
			return;
		}
		if (!file) {
			setLocalError("Choose an audio file to transcribe.");
			return;
		}
		await transcribe(file);
	}

	function set<Key extends keyof TranscriptionSettings>(
		key: Key,
		value: TranscriptionSettings[Key],
	) {
		setSettings((current) => {
			const next = { ...current };
			if (value === undefined || value === "") {
				delete next[key];
			} else {
				next[key] = value;
			}
			return next;
		});
	}

	return (
		<Workspace
			empty={runs.length === 0}
			scroll={scroll}
			{...(localError ? { error: localError } : {})}
			composer={
				<>
					{file ? (
						<Chosen
							disabled={busy}
							file={file.file}
							onClear={() => {
								URL.revokeObjectURL(file.url);
								setFile(null);
							}}
							url={file.url}
						/>
					) : null}
					<Composer
						accepted={AUDIO_TYPES}
						busy={busy}
						canSend={file !== null}
						files={[]}
						modelPicker={
							<ModelSelect
								capability="transcription"
								modelId={model.id}
								models={models}
								onSelect={onSelect}
							/>
						}
						onFiles={choose}
						onPrompt={() => {
							/* intentionally empty */
						}}
						onRemove={() => {
							/* intentionally empty */
						}}
						onReset={() => {
							request.current?.abort();
							setRuns([]);
							setFile(null);
							setLocalError(undefined);
						}}
						onSend={send}
						onSettings={() => setSettingsOpen(true)}
						onStop={() => request.current?.abort()}
						placeholder={
							file ? "Send to transcribe" : "Attach an audio file to transcribe"
						}
						prompt=""
						reading={false}
						readOnly
					/>
					{notice ? (
						<p className="sr-only" role="status">
							{notice}
						</p>
					) : null}
				</>
			}
			transcript={runs.map((run) => (
				<TranscriptionRunView
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
				<DialogContent className="md:w-xl" layout="sectioned">
					<DialogHeader>
						<DialogTitle>Transcription settings</DialogTitle>
						<DialogDescription>
							Anything left on Default is not sent, so the model applies its
							own.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<Select
							description="json and verbose_json answer with JSON; text, srt and vtt answer with the file you would save."
							label="Response format"
							onValueChange={(value) =>
								set(
									"responseFormat",
									value === "default" || value === null
										? undefined
										: (value as ResponseFormat),
								)
							}
							value={settings.responseFormat ?? "default"}
						>
							<SelectItem value="default">Default</SelectItem>
							{RESPONSE_FORMATS.map((format) => (
								<SelectItem key={format} value={format}>
									{format}
								</SelectItem>
							))}
						</Select>
						{settings.responseFormat === "verbose_json" ? (
							<Select
								description="Only verbose_json carries them."
								label="Timestamps"
								onValueChange={(value) =>
									set(
										"timestampGranularities",
										value === "default" || value === null ? undefined : [value],
									)
								}
								value={settings.timestampGranularities?.[0] ?? "default"}
							>
								<SelectItem value="default">Default</SelectItem>
								{TIMESTAMP_GRANULARITIES.map((granularity) => (
									<SelectItem key={granularity} value={granularity}>
										{granularity}
									</SelectItem>
								))}
							</Select>
						) : null}
						<Input
							description="An ISO-639-1 code such as es or en. Guessed when left empty."
							label="Language"
							onChange={(event) => set("language", event.target.value.trim())}
							placeholder="Detect"
							value={settings.language ?? ""}
						/>
						<NumberField.Root
							max={1}
							min={0}
							onValueChange={(value) => set("temperature", value ?? undefined)}
							step={0.1}
							value={settings.temperature ?? null}
						>
							<NumberField.ScrubArea>
								<label
									className="font-medium text-sm"
									htmlFor="playground-transcription-temperature"
								>
									Temperature
								</label>
							</NumberField.ScrubArea>
							<NumberField.Group>
								<NumberField.Decrement aria-label="Lower temperature" />
								<NumberField.Input
									id="playground-transcription-temperature"
									placeholder="Default"
								/>
								<NumberField.Increment aria-label="Higher temperature" />
							</NumberField.Group>
						</NumberField.Root>
						<Textarea
							description="Names and jargon the audio contains, to steer the spelling."
							label="Prompt"
							onChange={(event) => set("prompt", event.target.value)}
							placeholder="Optional"
							rows={3}
							value={settings.prompt ?? ""}
						/>
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
