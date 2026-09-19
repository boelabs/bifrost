"use client";

import { Progress } from "#/components/ui/progress";
import { ResponseLoader } from "./ResponseLoader";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";

import {
	type VideoReference,
	type VideoSettings,
	videoContentUrl,
	type VideoJob,
	type VideoRun,
} from "./videos";

import {
	IconPlayerPlay,
	IconDownload,
	IconRefresh,
	IconRotate2,
} from "@tabler/icons-react";

import {
	MESSAGE_ACTION_ICON,
	MESSAGE_ACTION,
	UserBubble,
} from "./MessageParts";

/** The settings a run was made with, so two runs in the same transcript can be told apart. */
export function summary(run: VideoRun): string {
	const settings: VideoSettings = run.settings;
	return [
		settings.task,
		settings.seconds === undefined ? undefined : `${settings.seconds}s`,
		settings.size ?? settings.aspectRatio,
		settings.resolution,
		settings.quality,
		settings.seed === undefined ? undefined : `seed ${settings.seed}`,
		settings.generateAudio === true
			? "with audio"
			: settings.generateAudio === false
				? "silent"
				: undefined,
		run.references.length
			? `${run.references.length} attachment${run.references.length > 1 ? "s" : ""}`
			: undefined,
	]
		.filter(Boolean)
		.join(" · ");
}

function duration(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** When the gateway will stop serving these bytes — a fact of this endpoint, worth saying once. */
function expiry(job: VideoJob | undefined): string | undefined {
	if (!job?.expires_at) {
		return undefined;
	}
	return `available until ${new Date(job.expires_at * 1000).toLocaleTimeString(
		undefined,
		{ hour: "2-digit", minute: "2-digit" },
	)}`;
}

const ROLE_LABEL: Record<VideoReference["role"], string> = {
	reference: "Reference",
	first_frame: "First frame",
	last_frame: "Last frame",
};

function Reference({ reference }: { reference: VideoReference }) {
	const image = reference.mediaType.startsWith("image/");
	return (
		<figure className="flex flex-col items-center gap-1">
			{image ? (
				// biome-ignore lint/performance/noImgElement: a data: URL, which next/image cannot optimise
				<img
					alt={reference.filename}
					className="size-20 rounded-xl border border-border/60 object-cover"
					src={reference.url}
				/>
			) : (
				<span className="flex size-20 items-center justify-center rounded-xl border border-border/60 bg-surface-2">
					<IconPlayerPlay aria-hidden className="size-6 text-fg-muted" />
				</span>
			)}
			<figcaption className="max-w-20 truncate text-[11px] text-fg-muted">
				{ROLE_LABEL[reference.role]}
			</figcaption>
		</figure>
	);
}

/**
 * How far along the job is, said with whatever the gateway has given.
 *
 * A provider that reports progress gets a bar; one that only says "in_progress" gets the same dot
 * matrix every other capability waits behind. Inventing a percentage nobody reported would be worse
 * than admitting there is none.
 */
function Working({ job }: { job: VideoJob | undefined }) {
	const progress = job?.progress ?? 0;
	const label = job?.status === "in_progress" ? "Generating" : "Queued";
	if (!job || progress <= 0) {
		return (
			<div className="flex items-center gap-3">
				<ResponseLoader />
				<span className="text-fg-muted text-xs">{label}</span>
			</div>
		);
	}
	return (
		<Progress.Root className="max-w-sm" value={Math.min(100, progress)}>
			<Progress.Label>{label}</Progress.Label>
			<Progress.Value />
			<Progress.Track>
				<Progress.Indicator />
			</Progress.Track>
		</Progress.Root>
	);
}

/**
 * One generation: what was asked, how far it got, and the video itself.
 *
 * The player points at the gateway's content endpoint through this app's relay rather than at a
 * blob, so the bytes are streamed and seekable and there is no object URL whose life anyone has to
 * manage. A stopped run keeps its job id, which is what makes "Check again" possible at all: the
 * work carries on upstream whether or not this page is still watching it.
 */
export function VideoRunView({
	run,
	onRetry,
	onCheck,
}: {
	run: VideoRun;
	onRetry: () => void;
	onCheck: () => void;
}) {
	const ready = run.state === "completed" && run.job?.status === "completed";
	const resumable = run.state === "stopped" && run.job !== undefined;
	const detail = summary(run);
	return (
		<section
			aria-label="Video run"
			className="flex w-full flex-col gap-4 px-4 last:min-h-[calc(var(--transcript-height,0px)-3.5rem)]"
		>
			<article
				aria-label="You message"
				className="group/message ml-auto flex w-full max-w-[90%] flex-col items-end gap-1"
			>
				{run.references.length ? (
					<div className="flex flex-wrap justify-end gap-2">
						{run.references.map((reference) => (
							<Reference key={reference.id} reference={reference} />
						))}
					</div>
				) : null}
				<UserBubble
					hasAttachments={run.references.length > 0}
					text={run.prompt}
				/>
			</article>
			<article
				aria-label="Assistant message"
				className="flex w-full min-w-0 flex-col gap-2"
			>
				{run.state === "running" ? <Working job={run.job} /> : null}
				{run.state === "stopped" ? (
					<div className="flex flex-wrap items-center gap-2 text-fg-muted text-xs">
						<Status tone="muted">Stopped watching</Status>
						{resumable ? (
							<span>The job may still be running on the provider.</span>
						) : null}
					</div>
				) : null}
				{ready && run.job ? (
					<figure className="group/video relative overflow-hidden rounded-2xl border border-border/60 bg-surface-2">
						{/* biome-ignore lint/a11y/useMediaCaption: a generated video has no track to offer */}
						<video
							className="block w-full"
							controls
							playsInline
							preload="metadata"
							src={videoContentUrl(run.job.id)}
						/>
						<a
							aria-label="Download video"
							className="absolute top-2 right-2 inline-flex size-9 items-center justify-center rounded-xl bg-surface/80 text-fg opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 group-hover/video:opacity-100"
							download={`${run.job.id}.mp4`}
							href={videoContentUrl(run.job.id)}
							title="Download"
						>
							<IconDownload aria-hidden className="size-4.5" />
						</a>
					</figure>
				) : null}
				{run.error ? (
					<ErrorNote width="fit-content">{run.error}</ErrorNote>
				) : null}
				<div className="mt-1 -ml-2 flex h-10 shrink-0 items-center gap-0.5 lg:h-8">
					<Button
						aria-label="Generate again"
						className={MESSAGE_ACTION}
						disabled={run.state === "running"}
						mode="icon"
						onClick={onRetry}
						size="sm"
						title="Generate again"
						type="button"
						variant="ghost"
					>
						<IconRotate2 aria-hidden className={MESSAGE_ACTION_ICON} />
					</Button>
					{resumable ? (
						<Button
							aria-label="Check this job again"
							className={MESSAGE_ACTION}
							mode="icon"
							onClick={onCheck}
							size="sm"
							title="Check again"
							type="button"
							variant="ghost"
						>
							<IconRefresh aria-hidden className={MESSAGE_ACTION_ICON} />
						</Button>
					) : null}
					<p className="px-2 text-fg-muted text-xs">
						{[
							run.model,
							detail,
							run.durationMs === undefined
								? undefined
								: duration(run.durationMs),
							ready ? expiry(run.job) : undefined,
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				</div>
			</article>
		</section>
	);
}
