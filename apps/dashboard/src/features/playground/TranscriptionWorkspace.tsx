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
			<IconFileText className="size-5 shrink-0 text-fg-muted" aria-hidden />
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">{file.name}</p>
				<p className="text-fg-muted text-xs">
					{file.type || "audio"} · {bytes(file.size)}
				</p>
			</div>
			{/* biome-ignore lint/a11y/useMediaCaption: the captions are what this page is producing */}
			<audio src={url} controls className="h-9 max-w-56 shrink-0" />
			<Button
				type="button"
				variant="ghost"
				size="sm"
				mode="icon"
				aria-label="Remove the file"
				title="Remove the file"
				disabled={disabled}
				onClick={onClear}
			>
				<IconX className="size-4.5" aria-hidden />
			</Button>
		</div>
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
						className="size-4 shrink-0 text-fg-muted"
						aria-hidden
					/>
					<span className="truncate text-sm">{run.filename}</span>
				</div>
				{/* biome-ignore lint/a11y/useMediaCaption: the captions are what this page is producing */}
				<audio src={run.audio} controls className="h-9 max-w-64" />
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
				{run.text && subtitles ? (
					<pre className="overflow-x-auto rounded-xl border border-border/50 bg-card p-3 font-mono text-xs leading-5">
						{run.text}
					</pre>
				) : run.text ? (
					<p className="whitespace-pre-wrap text-base leading-7 [overflow-wrap:anywhere]">
						{run.text}
					</p>
				) : null}
				{run.segments.length ? (
					<ol className="flex flex-col gap-1">
						{run.segments.map((segment, index) => (
							<li
								// biome-ignore lint/suspicious/noArrayIndexKey: segments are a sequence, and their order is their identity
								key={index}
								className="flex gap-3 rounded-lg px-2 py-1 text-sm odd:bg-surface-2/60"
							>
								<span className="shrink-0 font-mono text-fg-muted text-xs leading-6">
									{segment.start !== undefined ? timestamp(segment.start) : "—"}
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
						text={run.text}
						label="Copy transcript"
						disabled={!run.text}
						onCopy={onCopy}
					/>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						mode="icon"
						className={MESSAGE_ACTION}
						aria-label="Transcribe this file again"
						title="Transcribe this file again"
						disabled={run.state === "running"}
						onClick={onRetry}
					>
						<IconRotate2 className={MESSAGE_ACTION_ICON} aria-hidden />
					</Button>
					<p className="px-2 text-fg-muted text-xs">
						{[
							run.model,
							run.settings.responseFormat,
							run.language,
							run.audioDuration !== undefined
								? `${run.audioDuration.toFixed(1)}s of audio`
								: undefined,
							run.durationMs !== undefined
								? duration(run.durationMs)
								: undefined,
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
		if (runs.length && scroll.current)
			scroll.current.scrollTop = scroll.current.scrollHeight;
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
		if (!first) return;
		if (first.size === 0) {
			setLocalError(`${first.name}: the file is empty.`);
			return;
		}
		setLocalError(undefined);
		// One request, one file: a second choice replaces the first rather than queueing.
		setFile((current) => {
			if (current) URL.revokeObjectURL(current.url);
			return { file: first, url: URL.createObjectURL(first) };
		});
	}

	async function transcribe(chosen: { file: File; url: string }) {
		setLocalError(undefined);
		setNotice(undefined);
		const id = crypto.randomUUID();
		setRuns((current) => [
			...current,
			{
				id,
				filename: chosen.file.name,
				file: chosen.file,
				audio: chosen.url,
				mediaType: chosen.file.type,
				model: model.id,
				settings,
				state: "running",
				text: "",
				segments: [],
			},
		]);
		// The run owns the object URL from here, so the picker can take another file.
		setFile((current) => (current === chosen ? null : current));
		const controller = new AbortController();
		request.current = controller;
		const started = performance.now();
		try {
			const transcription = await runTranscription(
				{ model: model.id, file: chosen.file, settings },
				{ signal: controller.signal },
			);
			if (!alive.current) return;
			update(id, {
				state: "completed",
				text: transcription.text,
				segments: transcription.segments,
				durationMs: performance.now() - started,
				...(transcription.language !== undefined
					? { language: transcription.language }
					: {}),
				...(transcription.duration !== undefined
					? { audioDuration: transcription.duration }
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
			if (value === undefined || value === "") delete next[key];
			else next[key] = value;
			return next;
		});
	}

	return (
		<Workspace
			scroll={scroll}
			empty={runs.length === 0}
			{...(localError ? { error: localError } : {})}
			transcript={runs.map((run) => (
				<TranscriptionRunView
					key={run.id}
					run={run}
					onCopy={copy}
					// The same audio again, under whatever the settings say now.
					onRetry={() => {
						if (!busy) void transcribe({ file: run.file, url: run.audio });
					}}
				/>
			))}
			composer={
				<>
					{file ? (
						<Chosen
							file={file.file}
							url={file.url}
							disabled={busy}
							onClear={() => {
								URL.revokeObjectURL(file.url);
								setFile(null);
							}}
						/>
					) : null}
					<Composer
						prompt=""
						onPrompt={() => {}}
						files={[]}
						onRemove={() => {}}
						onFiles={choose}
						placeholder={
							file ? "Send to transcribe" : "Attach an audio file to transcribe"
						}
						readOnly
						accepted={AUDIO_TYPES}
						reading={false}
						busy={busy}
						canSend={file !== null}
						onSend={send}
						onStop={() => request.current?.abort()}
						onSettings={() => setSettingsOpen(true)}
						onReset={() => {
							request.current?.abort();
							setRuns([]);
							setFile(null);
							setLocalError(undefined);
						}}
						modelPicker={
							<ModelSelect
								models={models}
								capability="transcription"
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
				<DialogContent layout="sectioned" className="md:w-xl">
					<DialogHeader>
						<DialogTitle>Transcription settings</DialogTitle>
						<DialogDescription>
							Anything left on Default is not sent, so the model applies its
							own.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<Select
							label="Response format"
							description="json and verbose_json answer with JSON; text, srt and vtt answer with the file you would save."
							value={settings.responseFormat ?? "default"}
							onValueChange={(value) =>
								set(
									"responseFormat",
									value === "default" || value === null
										? undefined
										: (value as ResponseFormat),
								)
							}
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
								label="Timestamps"
								description="Only verbose_json carries them."
								value={settings.timestampGranularities?.[0] ?? "default"}
								onValueChange={(value) =>
									set(
										"timestampGranularities",
										value === "default" || value === null ? undefined : [value],
									)
								}
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
							label="Language"
							description="An ISO-639-1 code such as es or en. Guessed when left empty."
							value={settings.language ?? ""}
							onChange={(event) => set("language", event.target.value.trim())}
							placeholder="Detect"
						/>
						<NumberField.Root
							value={settings.temperature ?? null}
							onValueChange={(value) => set("temperature", value ?? undefined)}
							min={0}
							max={1}
							step={0.1}
						>
							<NumberField.ScrubArea>
								<label
									htmlFor="playground-transcription-temperature"
									className="font-medium text-sm"
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
							label="Prompt"
							description="Names and jargon the audio contains, to steer the spelling."
							value={settings.prompt ?? ""}
							onChange={(event) => set("prompt", event.target.value)}
							rows={3}
							placeholder="Optional"
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
