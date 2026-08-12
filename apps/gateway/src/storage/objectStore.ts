import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { GatewayError } from "#core/errors.ts";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import { env } from "#config/env.ts";

import {
	DeleteObjectCommand,
	HeadObjectCommand,
	GetObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

/** A byte range: from an offset (optionally bounded) or the last `suffix` bytes. */
export type ObjectRange = { start: number; end?: number } | { suffix: number };

export interface StoredObject {
	body: ReadableStream<Uint8Array>;
	contentType: string;
	contentLength?: number;
	etag?: string;
	range?: {
		start: number;
		end: number;
		total: number;
	};
}

export interface PutObjectInput {
	key: string;
	body: ReadableStream<Uint8Array> | Uint8Array;
	contentType: string;
	contentLength?: number;
}

function rangeNotSatisfiable(): GatewayError {
	return new GatewayError({
		class: "bad_request",
		status: 416,
		code: "range_not_satisfiable",
		message: "Requested byte range is not satisfiable",
		publicMessage: "The requested byte range is not satisfiable.",
	});
}

/** Resolves an ObjectRange against a known total size into inclusive [start, end]. */
export function resolveRange(
	range: ObjectRange,
	totalSize: number,
): { start: number; end: number } {
	if ("suffix" in range) {
		if (range.suffix <= 0 || totalSize === 0) throw rangeNotSatisfiable();
		return { start: Math.max(0, totalSize - range.suffix), end: totalSize - 1 };
	}
	const end =
		range.end !== undefined
			? Math.min(range.end, totalSize - 1)
			: totalSize - 1;
	if (range.start >= totalSize || end < range.start)
		throw rangeNotSatisfiable();
	return { start: range.start, end };
}

function toHttpRange(range: ObjectRange): string {
	if ("suffix" in range) return `bytes=-${range.suffix}`;
	return range.end === undefined
		? `bytes=${range.start}-`
		: `bytes=${range.start}-${range.end}`;
}

export interface ObjectStore {
	readonly backend: "disabled" | "local" | "s3";
	put(input: PutObjectInput): Promise<{ etag?: string }>;
	get(key: string, range?: ObjectRange): Promise<StoredObject>;
	head(key: string): Promise<Omit<StoredObject, "body">>;
	delete(key: string): Promise<void>;
}

function notConfigured(): GatewayError {
	return new GatewayError({
		class: "server",
		status: 503,
		code: "object_storage_not_configured",
		message: "Object storage is not configured",
		publicMessage: "Object storage is not configured for this gateway.",
	});
}

function missingObject(key: string): GatewayError {
	return new GatewayError({
		class: "not_found",
		code: "object_not_found",
		message: `Object not found: ${key}`,
	});
}

function assertSafeKey(key: string): void {
	if (!key || key.startsWith("/") || key.includes("\\") || key.includes("..")) {
		throw new GatewayError({
			class: "server",
			message: `Unsafe object key: ${key}`,
		});
	}
}

function toNodeReadable(
	body: ReadableStream<Uint8Array> | Uint8Array,
): Readable {
	return body instanceof Uint8Array
		? Readable.from(body)
		: Readable.fromWeb(body);
}

function toWebReadable(body: unknown): ReadableStream<Uint8Array> {
	if (body instanceof ReadableStream) return body;
	if (body instanceof Uint8Array) return Readable.toWeb(Readable.from(body));
	if (
		body &&
		typeof (body as { transformToWebStream?: unknown }).transformToWebStream ===
			"function"
	) {
		return (
			body as { transformToWebStream: () => ReadableStream<Uint8Array> }
		).transformToWebStream();
	}
	return Readable.toWeb(body as Readable) as ReadableStream<Uint8Array>;
}

function parseContentRange(
	value: string | undefined,
): StoredObject["range"] | undefined {
	const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
	if (!match) return undefined;
	return {
		start: Number(match[1]),
		end: Number(match[2]),
		total: Number(match[3]),
	};
}

class DisabledObjectStore implements ObjectStore {
	readonly backend = "disabled" as const;

	async put(): Promise<{ etag?: string }> {
		throw notConfigured();
	}

	async get(): Promise<StoredObject> {
		throw notConfigured();
	}

	async head(): Promise<Omit<StoredObject, "body">> {
		throw notConfigured();
	}

	async delete(): Promise<void> {
		throw notConfigured();
	}
}

class LocalObjectStore implements ObjectStore {
	readonly backend = "local" as const;
	private readonly root: string;

	constructor(root: string) {
		this.root = resolve(root);
	}

	private pathFor(key: string): string {
		assertSafeKey(key);
		const path = resolve(this.root, key);
		if (!path.startsWith(this.root)) {
			throw new GatewayError({
				class: "server",
				message: `Object key escapes storage root: ${key}`,
			});
		}
		return path;
	}

	async put(input: PutObjectInput): Promise<{ etag?: string }> {
		const path = this.pathFor(input.key);
		await mkdir(dirname(path), { recursive: true });
		await pipeline(toNodeReadable(input.body), createWriteStream(path));
		return {};
	}

	async get(key: string, range?: ObjectRange): Promise<StoredObject> {
		const path = this.pathFor(key);
		let info: Awaited<ReturnType<typeof stat>>;
		try {
			info = await stat(path);
		} catch {
			throw missingObject(key);
		}
		if (info.size === 0) {
			if (range) throw rangeNotSatisfiable();
			return {
				body: Readable.toWeb(Readable.from([])) as ReadableStream<Uint8Array>,
				contentType: contentTypeForKey(key),
				contentLength: 0,
			};
		}
		const { start, end } = range
			? resolveRange(range, info.size)
			: { start: 0, end: info.size - 1 };
		return {
			body: Readable.toWeb(
				createReadStream(path, { start, end }),
			) as ReadableStream<Uint8Array>,
			contentType: contentTypeForKey(key),
			contentLength: end - start + 1,
			...(range ? { range: { start, end, total: info.size } } : {}),
		};
	}

	async head(key: string): Promise<Omit<StoredObject, "body">> {
		const path = this.pathFor(key);
		try {
			const info = await stat(path);
			return {
				contentType: contentTypeForKey(key),
				contentLength: info.size,
			};
		} catch {
			throw missingObject(key);
		}
	}

	async delete(key: string): Promise<void> {
		const path = this.pathFor(key);
		await unlink(path).catch((err: { code?: string }) => {
			if (err.code !== "ENOENT") throw err;
		});
	}
}

class S3ObjectStore implements ObjectStore {
	readonly backend = "s3" as const;
	private readonly client: S3Client;
	private readonly bucket: string;

	constructor() {
		const bucket = env.OBJECT_STORAGE_S3_BUCKET;
		const accessKeyId = env.OBJECT_STORAGE_S3_ACCESS_KEY_ID;
		const secretAccessKey = env.OBJECT_STORAGE_S3_SECRET_ACCESS_KEY;
		if (!bucket || !accessKeyId || !secretAccessKey) throw notConfigured();
		this.bucket = bucket;
		this.client = new S3Client({
			region: env.OBJECT_STORAGE_S3_REGION,
			...(env.OBJECT_STORAGE_S3_ENDPOINT
				? { endpoint: env.OBJECT_STORAGE_S3_ENDPOINT }
				: {}),
			forcePathStyle: env.OBJECT_STORAGE_S3_FORCE_PATH_STYLE,
			credentials: { accessKeyId, secretAccessKey },
		});
	}

	async put(input: PutObjectInput): Promise<{ etag?: string }> {
		assertSafeKey(input.key);
		// Multipart streaming upload: PutObjectCommand requires a known Content-Length,
		// and providers frequently stream video downloads chunked without one.
		const upload = new Upload({
			client: this.client,
			params: {
				Bucket: this.bucket,
				Key: input.key,
				Body: toNodeReadable(input.body),
				ContentType: input.contentType,
			},
		});
		const result = await upload.done();
		return result.ETag ? { etag: result.ETag } : {};
	}

	async get(key: string, range?: ObjectRange): Promise<StoredObject> {
		assertSafeKey(key);
		const result = await this.client
			.send(
				new GetObjectCommand({
					Bucket: this.bucket,
					Key: key,
					...(range ? { Range: toHttpRange(range) } : {}),
				}),
			)
			.catch((err) => {
				const name = (err as { name?: string }).name;
				if (name === "NoSuchKey") throw missingObject(key);
				if (name === "InvalidRange") throw rangeNotSatisfiable();
				throw err;
			});
		const parsedRange = range
			? parseContentRange(result.ContentRange)
			: undefined;
		return {
			body: toWebReadable(result.Body),
			contentType: result.ContentType ?? contentTypeForKey(key),
			...(result.ContentLength !== undefined
				? { contentLength: result.ContentLength }
				: {}),
			...(result.ETag ? { etag: result.ETag } : {}),
			...(parsedRange ? { range: parsedRange } : {}),
		};
	}

	async head(key: string): Promise<Omit<StoredObject, "body">> {
		assertSafeKey(key);
		const result = await this.client
			.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
			.catch((err) => {
				if ((err as { name?: string }).name === "NotFound")
					throw missingObject(key);
				throw err;
			});
		return {
			contentType: result.ContentType ?? contentTypeForKey(key),
			...(result.ContentLength !== undefined
				? { contentLength: result.ContentLength }
				: {}),
			...(result.ETag ? { etag: result.ETag } : {}),
		};
	}

	async delete(key: string): Promise<void> {
		assertSafeKey(key);
		await this.client.send(
			new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
		);
	}
}

export function contentTypeForKey(key: string): string {
	if (key.endsWith(".mp4")) return "video/mp4";
	if (key.endsWith(".webm")) return "video/webm";
	if (key.endsWith(".png")) return "image/png";
	if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
	return "application/octet-stream";
}

let singleton: ObjectStore | undefined;

export function getObjectStore(): ObjectStore {
	if (singleton) return singleton;
	switch (env.OBJECT_STORAGE_BACKEND) {
		case "local":
			singleton = new LocalObjectStore(env.OBJECT_STORAGE_LOCAL_ROOT);
			break;
		case "s3":
			singleton = new S3ObjectStore();
			break;
		default:
			singleton = new DisabledObjectStore();
			break;
	}
	return singleton;
}

export function objectKey(namespace: string, parts: string[]): string {
	return join(namespace, ...parts).replaceAll("\\", "/");
}
