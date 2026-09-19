import { type GatewayRequest, gatewayForm } from "./gateway";
import { z } from "zod";

/**
 * Transcription: one audio file in, text out.
 *
 * The endpoint is multipart, and the response format decides the shape of the answer — `json` and
 * `verbose_json` come back as JSON, `text`, `srt` and `vtt` as the file you would save. The
 * playground reads all five, because which one a caller should ask for is exactly what an operator
 * comes here to find out.
 */

export const RESPONSE_FORMATS = [
	"json",
	"verbose_json",
	"text",
	"srt",
	"vtt",
] as const;
export type ResponseFormat = (typeof RESPONSE_FORMATS)[number];

export const TIMESTAMP_GRANULARITIES = ["segment", "word"] as const;

/** What the gateway accepts as audio, and what the file picker therefore offers. */
export const AUDIO_TYPES = [
	"audio/mpeg",
	"audio/mp4",
	"audio/mpga",
	"audio/m4a",
	"audio/wav",
	"audio/webm",
	"audio/ogg",
	"audio/flac",
	"video/mp4",
	"video/webm",
];

export interface TranscriptionSettings {
	responseFormat?: ResponseFormat;
	language?: string;
	prompt?: string;
	temperature?: number;
	timestampGranularities?: string[];
}

export const emptyTranscriptionSettings = (): TranscriptionSettings => ({});

export interface TranscriptionSegment {
	start?: number;
	end?: number;
	text: string;
}

export interface TranscriptionRun {
	id: string;
	filename: string;
	/** The file itself, so the same run can be repeated against other settings. */
	file: File;
	/** An object URL, so the audio that produced this text can be played back beside it. */
	audio: string;
	mediaType: string;
	model: string;
	settings: TranscriptionSettings;
	state: "running" | "completed" | "failed" | "stopped";
	text: string;
	segments: TranscriptionSegment[];
	language?: string;
	audioDuration?: number;
	error?: string;
	durationMs?: number;
}

const transcriptionResponse = z.looseObject({
	text: z.string().optional(),
	language: z.string().optional(),
	duration: z.number().optional(),
	segments: z
		.array(
			z.looseObject({
				start: z.number().optional(),
				end: z.number().optional(),
				text: z.string().optional(),
			}),
		)
		.optional(),
});

export interface Transcription {
	text: string;
	language?: string;
	duration?: number;
	segments: TranscriptionSegment[];
}

export function transcriptionForm(
	model: string,
	file: File,
	settings: TranscriptionSettings,
): FormData {
	const form = new FormData();
	form.set("model", model);
	form.set("file", file, file.name);
	if (settings.responseFormat) {
		form.set("response_format", settings.responseFormat);
	}
	if (settings.language) {
		form.set("language", settings.language);
	}
	if (settings.prompt) {
		form.set("prompt", settings.prompt);
	}
	if (settings.temperature !== undefined) {
		form.set("temperature", String(settings.temperature));
	}
	// Only `verbose_json` carries timestamps, so asking for them anywhere else is a rejection.
	if (
		settings.responseFormat === "verbose_json" &&
		settings.timestampGranularities?.length
	) {
		for (const granularity of settings.timestampGranularities) {
			form.append("timestamp_granularities[]", granularity);
		}
	}
	return form;
}

/**
 * The answer, whichever of the five shapes it arrived in.
 *
 * `text`, `srt` and `vtt` are plain text: the subtitle formats are kept verbatim rather than parsed,
 * because what an operator is checking there is the file itself.
 */
export function transcriptionFrom(
	body: string,
	contentType: string | null,
): Transcription {
	if (!contentType?.includes("json")) {
		return { text: body, segments: [] };
	}
	const parsed = transcriptionResponse.parse(JSON.parse(body));
	const segments = (parsed.segments ?? []).flatMap(
		(segment): TranscriptionSegment[] =>
			segment.text === undefined
				? []
				: [
						{
							text: segment.text,
							...(segment.start === undefined ? {} : { start: segment.start }),
							...(segment.end === undefined ? {} : { end: segment.end }),
						},
					],
	);
	return {
		text: parsed.text ?? segments.map((segment) => segment.text).join(" "),
		segments,
		...(parsed.language === undefined ? {} : { language: parsed.language }),
		...(parsed.duration === undefined ? {} : { duration: parsed.duration }),
	};
}

export async function runTranscription(
	input: { model: string; file: File; settings: TranscriptionSettings },
	options: GatewayRequest = {},
): Promise<Transcription> {
	return gatewayForm<Transcription>(
		"/audio/transcriptions",
		transcriptionForm(input.model, input.file, input.settings),
		// Subtitles and plain text are not JSON, so this one reads the body itself.
		{ ...options, parse: transcriptionFrom },
	);
}

export function timestamp(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const rest = seconds - minutes * 60;
	return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}
