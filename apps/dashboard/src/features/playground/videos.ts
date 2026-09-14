import { type GatewayRequest, gatewayJson, gatewayGet } from "./gateway";
import { z } from "zod";

/**
 * Video generation: the one capability that is not a request and an answer.
 *
 * `POST /v1/videos` starts a job and answers with its id; the video itself arrives minutes later,
 * as bytes on a second endpoint, and only once the job reports `completed`. So this module has two
 * halves: the request, built the way every other capability builds one, and `pollVideo` — the loop
 * that watches a job to a terminal state without leaving a timer behind.
 */

export const VIDEO_TASKS = [
	"text_to_video",
	"image_to_video",
	"reference_to_video",
	"edit",
	"extend",
] as const;
export type VideoTask = (typeof VIDEO_TASKS)[number];

export const VIDEO_ASPECT_RATIOS = [
	"16:9",
	"9:16",
	"1:1",
	"4:3",
	"3:4",
	"3:2",
	"2:3",
	"21:9",
	"9:21",
] as const;

export const VIDEO_RESOLUTIONS = [
	"360p",
	"480p",
	"720p",
	"1080p",
	"1K",
	"2K",
	"4K",
] as const;

export const VIDEO_QUALITIES = [
	"auto",
	"low",
	"medium",
	"high",
	"native",
] as const;

/** What may be attached as a guiding asset, and what the file picker therefore offers. */
export const REFERENCE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"video/mp4",
	"video/webm",
];

/**
 * References travel as base64 inside the JSON request, which inflates them by a third and holds
 * them in memory twice over. The gateway's own limit is far higher; this one exists so that
 * choosing a phone recording by mistake says so instead of freezing the tab.
 */
export const MAX_REFERENCE_BYTES = 24 * 1024 * 1024;

/**
 * What an attached file is for. Most are references the model may draw on; an image can instead pin
 * the first or last frame, which is a different field on the wire.
 */
export type ReferenceRole = "reference" | "first_frame" | "last_frame";

export interface VideoReference {
	id: string;
	filename: string;
	mediaType: string;
	/** A data URL: what the request carries, and what the chip previews. */
	url: string;
	role: ReferenceRole;
}

/**
 * What the operator chose. `undefined` means "not chosen", and an unchosen field is left out of the
 * request entirely rather than sent as a default — the gateway validates every parameter against the
 * model's own profile, and a value nobody asked for is a rejection nobody asked for either.
 *
 * `size` and `aspectRatio`/`resolution` are two ways of saying the same thing, and the gateway
 * rejects both at once, so the settings dialog keeps them mutually exclusive rather than validating
 * them afterwards.
 */
export interface VideoSettings {
	task?: VideoTask;
	seconds?: number;
	aspectRatio?: string;
	resolution?: string;
	size?: string;
	seed?: number;
	quality?: string;
	generateAudio?: boolean;
}

export const emptyVideoSettings = (): VideoSettings => ({});

const videoJobSchema = z.looseObject({
	id: z.string().min(1),
	status: z.enum(["queued", "in_progress", "completed", "failed"]),
	progress: z.number().optional(),
	model: z.string().optional(),
	prompt: z.string().optional(),
	created_at: z.number().optional(),
	completed_at: z.number().nullable().optional(),
	expires_at: z.number().nullable().optional(),
	seconds: z.union([z.string(), z.number()]).optional(),
	size: z.string().optional(),
	quality: z.string().optional(),
	error: z
		.looseObject({
			code: z.string().nullable().optional(),
			message: z.string(),
		})
		.nullable()
		.optional(),
});

/** The gateway's video object, as the playground reads it. */
export type VideoJob = z.infer<typeof videoJobSchema>;

/** One generation in the transcript, whatever stage it has reached. */
export interface VideoRun {
	id: string;
	prompt: string;
	references: VideoReference[];
	model: string;
	settings: VideoSettings;
	state: "running" | "completed" | "failed" | "stopped";
	/** The gateway's job, from the moment it exists — a stopped run is resumed from it. */
	job?: VideoJob;
	error?: string;
	durationMs?: number;
}

export function isTerminal(job: VideoJob): boolean {
	return job.status === "completed" || job.status === "failed";
}

function isImage(reference: VideoReference): boolean {
	return reference.mediaType.startsWith("image/");
}

/** The request body, with every unchosen field absent rather than defaulted. */
export function videoBody(
	model: string,
	prompt: string,
	settings: VideoSettings,
	references: VideoReference[] = [],
): Record<string, unknown> {
	const guiding = references.filter(
		(reference) => reference.role === "reference",
	);
	const frames = references.filter(
		(reference) => reference.role !== "reference",
	);
	return {
		model,
		prompt,
		...(settings.task !== undefined ? { task: settings.task } : {}),
		...(guiding.length
			? {
					input_references: guiding.map((reference) =>
						isImage(reference)
							? { type: "image_url", image_url: { url: reference.url } }
							: { type: "video_url", video_url: { url: reference.url } },
					),
				}
			: {}),
		...(frames.length
			? {
					frame_images: frames.map((reference) => ({
						type: "image_url",
						image_url: { url: reference.url },
						frame_type: reference.role,
					})),
				}
			: {}),
		...(settings.seconds !== undefined ? { seconds: settings.seconds } : {}),
		...(settings.size !== undefined ? { size: settings.size } : {}),
		...(settings.aspectRatio !== undefined
			? { aspect_ratio: settings.aspectRatio }
			: {}),
		...(settings.resolution !== undefined
			? { resolution: settings.resolution }
			: {}),
		...(settings.seed !== undefined ? { seed: settings.seed } : {}),
		...(settings.quality !== undefined ? { quality: settings.quality } : {}),
		...(settings.generateAudio !== undefined
			? { generate_audio: settings.generateAudio }
			: {}),
	};
}

/**
 * The combinations the gateway is going to refuse, said here instead.
 *
 * These mirror its task rules, and only the unambiguous ones: the point is that attaching a picture
 * to an `extend` says so at once rather than after a round trip. The gateway remains the authority —
 * whatever else it rejects is rendered exactly as it sent it.
 */
export function taskConflict(
	task: VideoTask | undefined,
	references: VideoReference[],
): string | undefined {
	const first = references.filter(
		(reference) => reference.role === "first_frame",
	).length;
	const last = references.filter(
		(reference) => reference.role === "last_frame",
	).length;
	if (first > 1 || last > 1)
		return "Mark at most one first frame and one last frame.";
	if (last === 1 && first === 0) return "A last frame requires a first frame.";
	if (task === undefined) return undefined;

	const guiding = references.filter(
		(reference) => reference.role === "reference",
	);
	const videos = guiding.filter((reference) => !isImage(reference)).length;
	const images = guiding.length - videos + first + last;
	if (task === "text_to_video" && references.length)
		return "text_to_video cannot be combined with attachments.";
	if (task === "image_to_video" && (images === 0 || videos > 0))
		return "image_to_video needs image attachments and no video.";
	if (task === "reference_to_video" && (guiding.length === 0 || first + last))
		return "reference_to_video needs references and cannot use frames.";
	if ((task === "edit" || task === "extend") && (videos !== 1 || first + last))
		return `${task} needs exactly one video attachment and no frames.`;
	return undefined;
}

/** What this file cannot be attached as, said before it is read into memory. */
export function referenceRejection(file: File): string | undefined {
	if (!REFERENCE_TYPES.includes(file.type))
		return `${file.name}: this file type cannot be used as a reference.`;
	if (!file.size) return `${file.name}: the file is empty.`;
	if (file.size > MAX_REFERENCE_BYTES)
		return `${file.name}: references are limited to ${Math.round(
			MAX_REFERENCE_BYTES / (1024 * 1024),
		)} MB here.`;
	return undefined;
}

/**
 * Where the finished video is served from: this app's own relay, which carries the operator's
 * session cookie and passes byte ranges through, so the player can seek rather than only play.
 * Never a blob — the bytes stay on the wire, and there is no object URL to revoke.
 */
export function videoContentUrl(id: string): string {
	return `/api/v1/videos/${encodeURIComponent(id)}/content?variant=video`;
}

export async function createVideo(
	input: {
		model: string;
		prompt: string;
		settings: VideoSettings;
		references: VideoReference[];
	},
	options: GatewayRequest = {},
): Promise<VideoJob> {
	return videoJobSchema.parse(
		await gatewayJson<unknown>(
			"/videos",
			videoBody(input.model, input.prompt, input.settings, input.references),
			options,
		),
	);
}

export async function retrieveVideo(
	id: string,
	options: GatewayRequest = {},
): Promise<VideoJob> {
	return videoJobSchema.parse(
		await gatewayGet<unknown>(`/videos/${encodeURIComponent(id)}`, options),
	);
}

function abortError(): Error {
	const error = new Error("Watching the video job was stopped.");
	error.name = "AbortError";
	return error;
}

/**
 * A wait that leaves nothing behind: aborting clears the timer rather than letting it fire into a
 * component that is already gone. Every escape from the loop below goes through here.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		const abort = () => {
			clearTimeout(timer);
			reject(abortError());
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", abort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", abort, { once: true });
	});
}

export interface PollOptions extends GatewayRequest {
	/** Called with every answer, so progress reaches the screen as it arrives. */
	onUpdate?: (job: VideoJob) => void;
	intervalMs?: number;
	maxIntervalMs?: number;
	timeoutMs?: number;
	now?: () => number;
	/** Injectable, so the loop can be tested without waiting for it. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Watches a job until it is `completed` or `failed`, and returns it.
 *
 * The interval backs off. The gateway answers from a poll it schedules itself, so asking often is
 * cheap — but a job that takes four minutes has no use for four hundred requests. The deadline is
 * what keeps a provider that never finishes from being watched forever: it ends the run with
 * something an operator can act on instead of spinning.
 */
export async function pollVideo(
	initial: VideoJob,
	options: PollOptions = {},
): Promise<VideoJob> {
	const {
		onUpdate,
		intervalMs = 1500,
		maxIntervalMs = 10_000,
		timeoutMs = 20 * 60_000,
		now = Date.now,
		sleep = delay,
	} = options;
	const deadline = now() + timeoutMs;
	let job = initial;
	let interval = intervalMs;
	while (!isTerminal(job)) {
		if (now() >= deadline)
			throw new Error(
				"The video is still being generated. Check again in a moment.",
			);
		await sleep(interval, options.signal);
		job = await retrieveVideo(job.id, options);
		onUpdate?.(job);
		interval = Math.min(Math.round(interval * 1.3), maxIntervalMs);
	}
	return job;
}
