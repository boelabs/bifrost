import type { CanonicalImageInput } from "#core/images.ts";
import { pipeline } from "node:stream/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { GatewayError } from "#core/errors.ts";
import { createWriteStream } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { env } from "#config/env.ts";
import { tmpdir } from "node:os";
import Busboy from "busboy";
import sharp from "sharp";

import {
	imageEditFieldsSchema,
	type ImageEditFields,
} from "#contracts/openai/images.ts";

const MAX_FILES = 17; // 16 inputs + mask
const MAX_IMAGE_BYTES = 50_000_000;
const MAX_MASK_BYTES = 4_000_000;

interface PendingUpload {
	field: "image" | "mask";
	path: string;
	filename: string;
	sizeBytes: number;
}

export interface ParsedImageEditMultipart {
	fields: ImageEditFields;
	images: CanonicalImageInput[];
	mask?: CanonicalImageInput;
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
	return [...basename(value || "image")]
		.map((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint < 32 || codePoint === 127 ? "_" : character;
		})
		.join("")
		.slice(0, 255);
}

function parseScalarFields(fields: Record<string, string>): unknown {
	const out: Record<string, unknown> = { ...fields };
	for (const key of ["n", "output_compression", "partial_images"]) {
		if (fields[key] !== undefined) out[key] = Number(fields[key]);
	}
	if (fields.stream !== undefined) {
		if (fields.stream !== "true" && fields.stream !== "false")
			throw badMultipart("stream must be true or false", "stream");
		out.stream = fields.stream === "true";
	}
	if (fields.extra_body !== undefined) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(fields.extra_body);
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
	return out;
}

async function inspectUpload(
	file: PendingUpload,
): Promise<CanonicalImageInput> {
	let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
	try {
		metadata = await sharp(file.path, {
			limitInputPixels: 100_000_000,
			animated: true,
		}).metadata();
	} catch {
		throw badMultipart(`Invalid image file "${file.filename}"`, file.field);
	}
	const format = metadata.format;
	if (
		!metadata.width ||
		!metadata.height ||
		!["png", "jpeg", "webp"].includes(format ?? "")
	) {
		throw badMultipart(
			`Unsupported image format for "${file.filename}"`,
			file.field,
		);
	}
	if ((metadata.pages ?? 1) > 1)
		throw badMultipart("Animated images are not supported", file.field);
	const mimeType = `image/${format}` as CanonicalImageInput["mimeType"];
	return {
		path: file.path,
		filename: file.filename,
		mimeType,
		sizeBytes: file.sizeBytes,
		width: metadata.width,
		height: metadata.height,
		...(metadata.hasAlpha !== undefined ? { hasAlpha: metadata.hasAlpha } : {}),
	};
}

export async function parseImageEditMultipart(
	request: Request,
): Promise<ParsedImageEditMultipart> {
	const contentType = request.headers.get("content-type");
	if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
		throw badMultipart("Content-Type must be multipart/form-data", null);
	}
	if (!request.body) throw badMultipart("Missing multipart body", null);

	const dir = await mkdtemp(join(tmpdir(), "bifrost-images-"));
	const cleanup = () => rm(dir, { recursive: true, force: true });
	const fields: Record<string, string> = {};
	const pending: PendingUpload[] = [];
	const writes: Promise<void>[] = [];
	let totalBytes = 0;
	let failure: GatewayError | null = null;
	let source: Readable | null = null;

	try {
		const bb = Busboy({
			headers: Object.fromEntries(request.headers.entries()),
			limits: {
				files: MAX_FILES,
				fileSize: MAX_IMAGE_BYTES,
				fields: 24,
				fieldSize: 65_536,
				parts: 48,
			},
		});

		bb.on("field", (name, value, info) => {
			if (info.valueTruncated)
				failure ??= badMultipart(`Field "${name}" exceeds 64 KiB`, name);
			if (fields[name] !== undefined)
				failure ??= badMultipart(`Duplicate field "${name}"`, name);
			fields[name] = value;
		});
		bb.on("file", (name, stream, info) => {
			const field =
				name === "image" || name === "image[]"
					? "image"
					: name === "mask"
						? "mask"
						: null;
			if (!field) {
				failure ??= badMultipart(`Unexpected file field "${name}"`, name);
				stream.resume();
				return;
			}
			if (field === "mask" && pending.some((file) => file.field === "mask")) {
				failure ??= badMultipart("Only one mask is allowed", "mask");
				stream.resume();
				return;
			}
			const file: PendingUpload = {
				field,
				path: join(dir, randomUUID()),
				filename: safeFilename(info.filename),
				sizeBytes: 0,
			};
			pending.push(file);
			stream.on("data", (chunk: Buffer) => {
				file.sizeBytes += chunk.length;
				totalBytes += chunk.length;
				if (totalBytes > env.IMAGES_MAX_MULTIPART_BYTES) {
					failure ??= badMultipart(
						"Multipart body exceeds the configured aggregate limit",
						null,
					);
					source?.destroy(failure);
				}
			});
			stream.on("limit", () => {
				failure ??= badMultipart(
					`File "${file.filename}" exceeds 50 MB`,
					field,
				);
			});
			writes.push(
				pipeline(stream, createWriteStream(file.path, { flags: "wx" })),
			);
		});
		bb.on("filesLimit", () => {
			failure ??= badMultipart(
				`At most ${MAX_FILES} file parts are allowed`,
				"image",
			);
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

		const parsed = imageEditFieldsSchema.safeParse(parseScalarFields(fields));
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

		const inspected = await Promise.all(pending.map(inspectUpload));
		const images = inspected.filter((_, i) => pending[i]?.field === "image");
		const mask = inspected.find((_, i) => pending[i]?.field === "mask");
		if (images.length === 0)
			throw badMultipart("At least one image file is required", "image");
		if (images.length > 16)
			throw badMultipart("At most 16 input images are allowed", "image");
		if (mask) {
			const firstImage = images[0];
			if (!firstImage)
				throw badMultipart("At least one image file is required", "image");
			if (mask.mimeType !== "image/png")
				throw badMultipart("mask must be a PNG image", "mask");
			if (mask.sizeBytes > MAX_MASK_BYTES)
				throw badMultipart("mask exceeds 4 MB", "mask");
			if (!mask.hasAlpha)
				throw badMultipart("mask must contain an alpha channel", "mask");
			if (
				mask.width !== firstImage.width ||
				mask.height !== firstImage.height
			) {
				throw badMultipart(
					"mask dimensions must match the first image",
					"mask",
				);
			}
		}

		return {
			fields: parsed.data,
			images,
			...(mask ? { mask } : {}),
			cleanup,
			logBody: {
				...parsed.data,
				extra_body: parsed.data.extra_body,
				image: images.map((image) => ({
					filename: image.filename,
					mime_type: image.mimeType,
					bytes: image.sizeBytes,
					width: image.width,
					height: image.height,
				})),
				...(mask
					? {
							mask: {
								filename: mask.filename,
								mime_type: mask.mimeType,
								bytes: mask.sizeBytes,
								width: mask.width,
								height: mask.height,
							},
						}
					: {}),
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
