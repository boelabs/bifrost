import type { CanonicalAudioInput } from "#core/audio.ts";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { GatewayError } from "#core/errors.ts";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { env } from "#config/env.ts";
import { tmpdir } from "node:os";
import Busboy from "busboy";

import {
	transcriptionFieldsSchema,
	type TranscriptionFields,
} from "#contracts/openai/audio.ts";

const MAX_AUDIO_BYTES = 26_214_400; // 25 MiB, OpenAI per-file limit

/** Extension -> mime for the formats /v1/audio/transcriptions accepts. */
const AUDIO_MIME: Record<string, string> = {
	flac: "audio/flac",
	mp3: "audio/mpeg",
	mpga: "audio/mpeg",
	mpeg: "audio/mpeg",
	m4a: "audio/mp4",
	mp4: "audio/mp4",
	wav: "audio/wav",
	webm: "audio/webm",
	ogg: "audio/ogg",
	oga: "audio/ogg",
};

/** Multipart fields that arrive as a list (`name[]`). */
const ARRAY_FIELDS = new Set(["timestamp_granularities", "include"]);

export interface ParsedTranscriptionMultipart {
	fields: TranscriptionFields;
	file: CanonicalAudioInput;
	cleanup(): Promise<void>;
	logBody: Record<string, unknown>;
}

function badMultipart(
	message: string,
	param: string | null = null,
): GatewayError {
	return new GatewayError({
		class: "bad_request",
		message,
		param,
		code: "invalid_multipart",
	});
}

function safeFilename(value: string): string {
	return [...basename(value || "audio")]
		.map((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint < 32 || codePoint === 127 ? "_" : character;
		})
		.join("")
		.slice(0, 255);
}

function mimeForFilename(filename: string): string | null {
	const ext = extname(filename).slice(1).toLowerCase();
	return AUDIO_MIME[ext] ?? null;
}

/** Builds the object the schema validates: coerces scalars and groups the array fields. */
function buildFields(
	scalars: Record<string, string>,
	arrays: Record<string, string[]>,
): unknown {
	const out: Record<string, unknown> = { ...scalars };
	if (scalars.temperature !== undefined) {
		const value = Number(scalars.temperature);
		if (Number.isNaN(value))
			throw badMultipart("temperature must be a number", "temperature");
		out.temperature = value;
	}
	if (scalars.stream !== undefined) {
		if (scalars.stream !== "true" && scalars.stream !== "false") {
			throw badMultipart("stream must be true or false", "stream");
		}
		out.stream = scalars.stream === "true";
	}
	if (scalars.extra_body !== undefined) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(scalars.extra_body);
		} catch {
			throw badMultipart("extra_body must be valid JSON", "extra_body");
		}
		if (
			parsed === null ||
			typeof parsed !== "object" ||
			Array.isArray(parsed)
		) {
			throw badMultipart("extra_body must be a JSON object", "extra_body");
		}
		out.extra_body = parsed;
	}
	for (const [key, value] of Object.entries(arrays)) out[key] = value;
	return out;
}

export async function parseTranscriptionMultipart(
	request: Request,
): Promise<ParsedTranscriptionMultipart> {
	const contentType = request.headers.get("content-type");
	if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
		throw badMultipart("Content-Type must be multipart/form-data", null);
	}
	if (!request.body) throw badMultipart("Missing multipart body", null);

	const dir = await mkdtemp(join(tmpdir(), "bifrost-audio-"));
	const cleanup = () => rm(dir, { recursive: true, force: true });
	const scalars: Record<string, string> = {};
	const arrays: Record<string, string[]> = {};
	let upload: { path: string; filename: string } | null = null;
	const writes: Promise<void>[] = [];
	let failure: GatewayError | null = null;
	let source: Readable | null = null;

	try {
		const bb = Busboy({
			headers: Object.fromEntries(request.headers.entries()),
			limits: {
				files: 1,
				fileSize: MAX_AUDIO_BYTES,
				fields: 24,
				fieldSize: 65_536,
				parts: 32,
			},
		});

		bb.on("field", (name, value, info) => {
			if (info.valueTruncated)
				failure ??= badMultipart(`Field "${name}" exceeds 64 KiB`, name);
			if (name.endsWith("[]")) {
				const base = name.slice(0, -2);
				const list = arrays[base] ?? [];
				list.push(value);
				arrays[base] = list;
				return;
			}
			if (ARRAY_FIELDS.has(name)) {
				const list = arrays[name] ?? [];
				list.push(value);
				arrays[name] = list;
				return;
			}
			if (scalars[name] !== undefined)
				failure ??= badMultipart(`Duplicate field "${name}"`, name);
			scalars[name] = value;
		});
		bb.on("file", (name, stream, info) => {
			if (name !== "file") {
				failure ??= badMultipart(`Unexpected file field "${name}"`, name);
				stream.resume();
				return;
			}
			if (upload) {
				failure ??= badMultipart("Only one file is allowed", "file");
				stream.resume();
				return;
			}
			upload = {
				path: join(dir, randomUUID()),
				filename: safeFilename(info.filename),
			};
			stream.on("limit", () => {
				failure ??= badMultipart("file exceeds 25 MB", "file");
			});
			writes.push(
				pipeline(stream, createWriteStream(upload.path, { flags: "wx" })),
			);
		});
		bb.on("filesLimit", () => {
			failure ??= badMultipart("At most one file is allowed", "file");
		});
		bb.on("fieldsLimit", () => {
			failure ??= badMultipart("Too many multipart fields", null);
		});
		bb.on("partsLimit", () => {
			failure ??= badMultipart("Too many multipart parts", null);
		});

		const finished = new Promise<void>((resolve, reject) => {
			bb.once("finish", resolve);
			bb.once("error", reject);
		});
		const readable = Readable.fromWeb(
			request.body as import("node:stream/web").ReadableStream<Uint8Array>,
		);
		source = readable;
		const abort = () => readable.destroy(new Error("request aborted"));
		request.signal.addEventListener("abort", abort, { once: true });
		try {
			source.pipe(bb);
			await finished;
			await Promise.all(writes);
		} finally {
			request.signal.removeEventListener("abort", abort);
		}
		if (failure) throw failure;
		if (!upload) throw badMultipart("A `file` audio part is required", "file");
		const file = upload as { path: string; filename: string };

		const mimeType = mimeForFilename(file.filename);
		if (!mimeType) {
			throw badMultipart(
				`Unsupported audio format for "${file.filename}" (use flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav or webm)`,
				"file",
			);
		}
		const { size } = await stat(file.path);
		if (size === 0) throw badMultipart("The audio file is empty", "file");
		if (size > env.AUDIO_MAX_MULTIPART_BYTES) {
			throw badMultipart(
				"Multipart body exceeds the configured aggregate limit",
				null,
			);
		}

		const parsed = transcriptionFieldsSchema.safeParse(
			buildFields(scalars, arrays),
		);
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			throw new GatewayError({
				class: "bad_request",
				message: parsed.error.issues
					.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
					.join("; "),
				param: first ? first.path.join(".") : null,
			});
		}

		const audio: CanonicalAudioInput = {
			path: file.path,
			filename: file.filename,
			mimeType,
			sizeBytes: size,
		};
		return {
			fields: parsed.data,
			file: audio,
			cleanup,
			logBody: {
				...parsed.data,
				file: {
					filename: audio.filename,
					mime_type: audio.mimeType,
					bytes: audio.sizeBytes,
				},
			},
		};
	} catch (error) {
		await cleanup();
		if (GatewayError.is(error)) throw error;
		throw badMultipart(
			error instanceof Error ? error.message : "Invalid multipart body",
			null,
		);
	}
}
