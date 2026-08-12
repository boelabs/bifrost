/** Candidate-aware normalization for canonical file and image inputs. */

import { fetchPinnedHttps, type ResolvedAddress } from "./pinnedHttpsFetch.ts";
import type { DeploymentCandidate } from "#gateway/deploymentCandidates.ts";
import type { ContentPartInputSupport } from "#adapters/types.ts";
import type { UpstreamTransport } from "#core/transport.ts";
import { GatewayError } from "#core/errors.ts";
import { Worker } from "node:worker_threads";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type {
	CanonicalContentPart,
	CanonicalChatRequest,
	CanonicalImagePart,
	CanonicalFilePart,
	PdfParserEngine,
} from "#core/canonical.ts";

const MAX_INLINE_INPUT_BYTES = 50_000_000;
const MAX_MATERIALIZED_INPUT_BYTES = 20_000_000;
export const MAX_PORTABLE_CONTENT_INPUT_BYTES = 50_000_000;
const MAX_TEXT_CHARACTERS = 2_000_000;
const MAX_PDF_PAGES = 200;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_CONCURRENT_FETCHES = 4;
const SIGNATURED_IMAGE_MIME_TYPES = new Set([
	"image/avif",
	"image/bmp",
	"image/gif",
	"image/heic",
	"image/heif",
	"image/jpeg",
	"image/png",
	"image/tiff",
	"image/webp",
]);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	".avif": "image/avif",
	".bat": "text/x-bat",
	".bmp": "image/bmp",
	".conf": "text/plain",
	".csv": "text/csv",
	".css": "text/css",
	".eml": "message/rfc822",
	".gif": "image/gif",
	".heic": "image/heic",
	".heif": "image/heif",
	".html": "text/html",
	".htm": "text/html",
	".js": "text/javascript",
	".json": "application/json",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".jsx": "text/jsx",
	".log": "text/plain",
	".md": "text/markdown",
	".pdf": "application/pdf",
	".png": "image/png",
	".py": "text/x-python",
	".sh": "text/x-shellscript",
	".sql": "application/x-sql",
	".srt": "text/srt",
	".toml": "application/toml",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".ts": "text/typescript",
	".tsx": "text/tsx",
	".txt": "text/plain",
	".vtt": "text/vtt",
	".webp": "image/webp",
	".xml": "application/xml",
	".yaml": "application/yaml",
	".yml": "application/yaml",
};

const PORTABLE_APPLICATION_MIME_TYPES = new Set([
	"application/csv",
	"application/graphql",
	"application/javascript",
	"application/json5",
	"application/toml",
	"application/typescript",
	"application/x-bash",
	"application/x-httpd-php",
	"application/x-httpd-php-source",
	"application/x-json5",
	"application/x-ndjson",
	"application/x-patch",
	"application/x-powershell",
	"application/x-sql",
	"application/x-toml",
	"application/x-yaml",
	"message/rfc822",
]);

type ResolveHostname = (
	hostname: string,
) => Promise<readonly ResolvedAddress[]>;

type ResolvedFetch = (
	url: URL,
	options: {
		method: "GET";
		redirect: "manual";
		signal: AbortSignal;
		headers: Record<string, string>;
	},
	addresses: readonly ResolvedAddress[],
) => Promise<Response>;

interface ResolverDependencies {
	fetch: ResolvedFetch;
	resolveHostname: ResolveHostname;
}

interface MaterializedInput {
	bytes: Uint8Array;
	dataUrl: string;
	filename?: string;
	mimeType: string;
}

type MaterializablePart = CanonicalFilePart | CanonicalImagePart;

interface ContentSource {
	kind: "provider_file_id" | "url" | "data_url";
	value: string;
}

export interface ContentInputResolutionMetadata {
	pdfEngine: PdfParserEngine;
	materializedFiles: number;
	materializedImages: number;
	nativeFiles: number;
	nativeImages: number;
	parsedFiles: number;
}

export interface ResolvedContentInputRequest {
	request: CanonicalChatRequest;
	metadata?: ContentInputResolutionMetadata;
}

const DEFAULT_DEPENDENCIES: ResolverDependencies = {
	fetch: (url, options, addresses) =>
		fetchPinnedHttps(url, addresses, {
			method: options.method,
			headers: options.headers,
			signal: options.signal,
		}),
	resolveHostname: async (hostname) =>
		lookup(hostname, { all: true, verbatim: true }),
};

function requestError(
	message: string,
	code: string,
	publicMessage: string,
): GatewayError {
	return new GatewayError({
		class: "bad_request",
		code,
		param: "messages",
		message,
		publicMessage,
		routingScope: "request",
	});
}

function candidateInputError(
	message: string,
	code: string,
	publicMessage: string,
	param = "messages",
): GatewayError {
	return new GatewayError({
		class: "bad_request",
		code,
		param,
		message,
		publicMessage,
		deploymentHealth: "neutral",
	});
}

function fileSource(part: CanonicalFilePart): ContentSource {
	const present: Array<[ContentSource["kind"], string]> = [];
	if (part.fileId !== undefined)
		present.push(["provider_file_id", part.fileId]);
	if (part.fileUrl !== undefined) present.push(["url", part.fileUrl]);
	if (part.fileData !== undefined) present.push(["data_url", part.fileData]);
	if (present.length !== 1) {
		throw requestError(
			`File input must contain exactly one source; received ${present.length}`,
			"invalid_file_source",
			"Each file input must contain exactly one of file_id, file_url, or file_data.",
		);
	}
	const [kind, value] = present[0]!;
	if (value.length === 0) {
		throw requestError(
			"File input source is empty",
			"invalid_file_source",
			"File input sources cannot be empty.",
		);
	}
	if (kind === "data_url" && /^https:\/\//i.test(value)) {
		return { kind: "url", value };
	}
	return { kind, value };
}

function imageSource(part: CanonicalImagePart): ContentSource {
	if (part.url.length === 0) {
		throw requestError(
			"Image input source is empty",
			"invalid_image_url",
			"Image input sources cannot be empty.",
		);
	}
	return /^data:/i.test(part.url)
		? { kind: "data_url", value: part.url }
		: { kind: "url", value: part.url };
}

function inputParts(req: CanonicalChatRequest): MaterializablePart[] {
	const parts: MaterializablePart[] = [];
	for (const message of req.messages) {
		if (!Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type === "file" || part.type === "image") parts.push(part);
		}
	}
	return parts;
}

export function hasContentInputs(req: CanonicalChatRequest): boolean {
	return req.messages.some(
		(message) =>
			Array.isArray(message.content) &&
			message.content.some((part) => part.type !== "text"),
	);
}

function normalizedMimeType(
	value: string | null | undefined,
): string | undefined {
	const mime = value?.split(";", 1)[0]?.trim().toLowerCase();
	return mime && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)
		? mime
		: undefined;
}

function extensionMime(value: string | undefined): string | undefined {
	if (!value) return undefined;
	let pathname = value;
	try {
		pathname = new URL(value).pathname;
	} catch {
		// A filename is already a valid lookup input.
	}
	const dot = pathname.lastIndexOf(".");
	if (dot < 0) return undefined;
	return MIME_BY_EXTENSION[pathname.slice(dot).toLowerCase()];
}

function dataUrlMime(value: string): string | undefined {
	return normalizedMimeType(/^data:([^;,]+)/i.exec(value)?.[1]);
}

function hintedFileMimeType(part: CanonicalFilePart): string | undefined {
	const source = fileSource(part);
	return (
		(source.kind === "data_url" ? dataUrlMime(source.value) : undefined) ??
		extensionMime(part.filename) ??
		(source.kind === "url" ? extensionMime(source.value) : undefined)
	);
}

function hintedImageMimeType(part: CanonicalImagePart): string | undefined {
	const source = imageSource(part);
	return source.kind === "data_url"
		? dataUrlMime(source.value)
		: extensionMime(source.value);
}

function isBlockedHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	return (
		normalized === "localhost" ||
		normalized.endsWith(".localhost") ||
		normalized.endsWith(".local") ||
		normalized.endsWith(".internal")
	);
}

type RemoteInputKind = "file" | "image";

function parseSafeHttpsUrl(value: string, kind: RemoteInputKind): URL {
	const param = kind === "file" ? "file_url" : "image_url";
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw requestError(
			`Invalid ${kind} URL: ${value}`,
			`invalid_${kind}_url`,
			`${param} must be a valid public HTTPS URL.`,
		);
	}
	const literalHost =
		url.hostname.startsWith("[") && url.hostname.endsWith("]")
			? url.hostname.slice(1, -1)
			: url.hostname;
	if (
		url.protocol !== "https:" ||
		url.username !== "" ||
		url.password !== "" ||
		url.hash !== "" ||
		isBlockedHostname(url.hostname) ||
		(isIP(literalHost) !== 0 && isBlockedAddress(literalHost))
	) {
		throw requestError(
			`Unsafe ${kind} URL: ${url.href}`,
			`unsafe_${kind}_url`,
			`${param} must be a public HTTPS URL without credentials or a fragment.`,
		);
	}
	return url;
}

function isBlockedIpv4(address: string): boolean {
	const octets = address.split(".").map(Number);
	if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value)))
		return true;
	const [a, b, c] = octets as [number, number, number, number];
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && (c === 0 || c === 2)) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 88 && c === 99) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

function ipv6Words(address: string): number[] | null {
	let normalized = address.toLowerCase().split("%", 1)[0]!;
	if (normalized.startsWith("[") && normalized.endsWith("]"))
		normalized = normalized.slice(1, -1);
	if (normalized.includes(".")) return null;
	const halves = normalized.split("::");
	if (halves.length > 2) return null;
	const left = halves[0] ? halves[0].split(":") : [];
	const right = halves[1] ? halves[1].split(":") : [];
	const missing = 8 - left.length - right.length;
	if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
	const words = [
		...left,
		...Array.from({ length: missing }, () => "0"),
		...right,
	].map((word) => Number.parseInt(word, 16));
	if (
		words.length !== 8 ||
		words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)
	)
		return null;
	return words;
}

function isBlockedIpv6(address: string): boolean {
	const words = ipv6Words(address);
	if (!words) return true;
	const first = words[0]!;
	const allZeroPrefix = words.slice(0, 7).every((word) => word === 0);
	return (
		(allZeroPrefix && (words[7] === 0 || words[7] === 1)) ||
		(words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) ||
		// Only conventional global unicast is accepted. This deliberately excludes translation
		// prefixes such as NAT64, which could otherwise reach a blocked IPv4 destination.
		(first & 0xe000) !== 0x2000 ||
		(first & 0xfe00) === 0xfc00 ||
		(first & 0xffc0) === 0xfe80 ||
		(first & 0xffc0) === 0xfec0 ||
		(first & 0xff00) === 0xff00 ||
		(first === 0x2001 && words[1] === 0) ||
		(first === 0x2001 && words[1] === 0x0db8) ||
		(first === 0x2001 && (words[1]! & 0xfff0) === 0x0010) ||
		(first === 0x2001 && (words[1]! & 0xfff0) === 0x0020) ||
		first === 0x2002 ||
		(first === 0x3fff && (words[1]! & 0xfff0) === 0)
	);
}

function isBlockedAddress(address: string): boolean {
	const normalized =
		address.startsWith("[") && address.endsWith("]")
			? address.slice(1, -1)
			: address;
	const family = isIP(normalized);
	if (family === 0) return true;
	return family === 4 ? isBlockedIpv4(normalized) : isBlockedIpv6(normalized);
}

async function assertPublicUrl(
	value: string,
	resolveHostname: ResolveHostname,
	kind: RemoteInputKind,
): Promise<{ url: URL; addresses: readonly ResolvedAddress[] }> {
	const url = parseSafeHttpsUrl(value, kind);
	const param = kind === "file" ? "file_url" : "image_url";

	const literalHost =
		url.hostname.startsWith("[") && url.hostname.endsWith("]")
			? url.hostname.slice(1, -1)
			: url.hostname;
	const literalFamily = isIP(literalHost);
	const addresses = literalFamily
		? [{ address: literalHost, family: literalFamily }]
		: await resolveHostname(url.hostname).catch((cause: unknown) => {
				throw candidateInputError(
					`Could not resolve ${kind} URL hostname ${url.hostname}: ${String(cause)}`,
					`${kind}_fetch_failed`,
					`The ${kind} URL hostname could not be resolved.`,
				);
			});
	if (
		addresses.length === 0 ||
		addresses.some(({ address }) => isBlockedAddress(address))
	) {
		throw requestError(
			`${kind} URL resolved to a non-public address: ${url.hostname}`,
			`unsafe_${kind}_url`,
			`${param} must resolve only to public network addresses.`,
		);
	}
	return { url, addresses };
}

function filenameFromUrl(url: URL): string | undefined {
	const segment = url.pathname.split("/").filter(Boolean).at(-1);
	if (!segment) return undefined;
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

function effectiveMimeType(
	declared: string | undefined,
	filename: string | undefined,
	bytes: Uint8Array,
): string {
	const sniffed = sniffMimeType(bytes);
	if (sniffed !== undefined) return sniffed;
	if (declared === undefined || declared === "application/octet-stream")
		return extensionMime(filename) ?? declared ?? "application/octet-stream";
	return declared;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
	return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
	return Buffer.from(bytes.subarray(start, start + length)).toString("ascii");
}

function sniffMimeType(bytes: Uint8Array): string | undefined {
	if (Buffer.from(bytes.subarray(0, 1_024)).indexOf("%PDF-", 0, "ascii") >= 0)
		return "application/pdf";
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		return "image/png";
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
	if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")
		return "image/gif";
	if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
		return "image/webp";
	if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp";
	if (
		startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
		startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
	)
		return "image/tiff";
	if (ascii(bytes, 4, 4) === "ftyp") {
		const brand = ascii(bytes, 8, 4).toLowerCase();
		if (brand === "avif" || brand === "avis") return "image/avif";
		if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
		if (["mif1", "msf1", "heif"].includes(brand)) return "image/heif";
	}
	return undefined;
}

async function readLimitedBody(
	response: Response,
	kind: RemoteInputKind,
): Promise<Uint8Array> {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_MATERIALIZED_INPUT_BYTES) {
		throw candidateInputError(
			`Remote ${kind} declares ${declared} bytes, above the ${MAX_MATERIALIZED_INPUT_BYTES} byte limit`,
			`${kind}_too_large`,
			`The ${kind} is too large for gateway materialization.`,
		);
	}
	if (!response.body) return new Uint8Array();

	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = response.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_MATERIALIZED_INPUT_BYTES) {
				await reader.cancel();
				throw candidateInputError(
					`Remote ${kind} exceeded the ${MAX_MATERIALIZED_INPUT_BYTES} byte limit`,
					`${kind}_too_large`,
					`The ${kind} is too large for gateway materialization.`,
				);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function fetchInput(
	value: string,
	signal: AbortSignal,
	dependencies: ResolverDependencies,
	kind: RemoteInputKind,
): Promise<MaterializedInput> {
	let current = value;
	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
		const validated = await assertPublicUrl(
			current,
			dependencies.resolveHostname,
			kind,
		);
		const { url, addresses } = validated;
		let response: Response;
		try {
			response = await dependencies.fetch(
				url,
				{
					method: "GET",
					redirect: "manual",
					signal: AbortSignal.any([
						signal,
						AbortSignal.timeout(FETCH_TIMEOUT_MS),
					]),
					headers: {
						accept:
							kind === "image"
								? "image/*, */*;q=0.1"
								: "application/pdf, text/*, application/json, */*;q=0.1",
					},
				},
				addresses,
			);
		} catch (cause) {
			throw candidateInputError(
				`Could not fetch ${kind} URL ${url.href}: ${String(cause)}`,
				`${kind}_fetch_failed`,
				`The ${kind} URL could not be fetched.`,
			);
		}

		if ([301, 302, 303, 307, 308].includes(response.status)) {
			const location = response.headers.get("location");
			if (!location || redirects === MAX_REDIRECTS) {
				throw candidateInputError(
					`${kind} URL exceeded ${MAX_REDIRECTS} redirects`,
					`${kind}_fetch_failed`,
					`The ${kind} URL has too many redirects.`,
				);
			}
			await response.body?.cancel();
			current = new URL(location, url).href;
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw candidateInputError(
				`${kind} URL returned HTTP ${response.status}`,
				`${kind}_fetch_failed`,
				`The ${kind} URL could not be fetched.`,
			);
		}

		const bytes = await readLimitedBody(response, kind);
		if (bytes.byteLength === 0) {
			throw requestError(
				`Remote ${kind} is empty`,
				`invalid_${kind}_data`,
				`The remote ${kind} cannot be empty.`,
			);
		}
		const filename = filenameFromUrl(url);
		const mimeType = effectiveMimeType(
			normalizedMimeType(response.headers.get("content-type")),
			filename,
			bytes,
		);
		return {
			bytes,
			dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
			...(filename !== undefined ? { filename } : {}),
			mimeType,
		};
	}
	throw new Error("unreachable");
}

function decodeDataUrl(
	value: string,
	filename: string | undefined,
	kind: RemoteInputKind,
): MaterializedInput {
	const match =
		/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([a-z0-9+/]*={0,2})$/i.exec(
			value,
		);
	if (!match) {
		throw requestError(
			`${kind} data is not a valid base64 data URL`,
			`invalid_${kind}_data`,
			`${kind} data must be a valid base64 data URL.`,
		);
	}
	const mimeType = normalizedMimeType(match[1]);
	if (!mimeType) {
		throw requestError(
			`Invalid ${kind} data MIME type: ${String(match[1])}`,
			`invalid_${kind}_data`,
			`${kind} data must include a valid MIME type.`,
		);
	}
	const encoded = match[2]!;
	if (encoded.length % 4 !== 0) {
		throw requestError(
			`${kind} data base64 has invalid padding`,
			`invalid_${kind}_data`,
			`${kind} data must contain valid padded base64.`,
		);
	}
	const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
	if (bytes.byteLength === 0) {
		throw requestError(
			`${kind} data is empty`,
			`invalid_${kind}_data`,
			`${kind} data cannot be empty.`,
		);
	}
	if (
		Buffer.from(bytes).toString("base64").replace(/=+$/, "") !==
		encoded.replace(/=+$/, "")
	) {
		throw requestError(
			`${kind} data base64 is not canonical`,
			`invalid_${kind}_data`,
			`${kind} data must contain valid base64.`,
		);
	}
	if (bytes.byteLength > MAX_INLINE_INPUT_BYTES) {
		throw requestError(
			`Inline ${kind} contains ${bytes.byteLength} bytes, above the ${MAX_INLINE_INPUT_BYTES} byte limit`,
			`${kind}_too_large`,
			`The ${kind} is too large for portable processing.`,
		);
	}
	const effective = effectiveMimeType(mimeType, filename, bytes);
	return {
		bytes,
		dataUrl: `data:${effective};base64,${encoded}`,
		...(filename !== undefined ? { filename } : {}),
		mimeType: effective,
	};
}

function mimeMatches(
	mimeType: string | undefined,
	patterns: readonly string[] | undefined,
): boolean {
	if (mimeType === undefined || patterns === undefined) return true;
	return patterns.some((pattern) => {
		if (pattern.endsWith("/*"))
			return mimeType.startsWith(pattern.slice(0, -1));
		return mimeType === pattern;
	});
}

function modelAllowsNativeFile(
	candidate: DeploymentCandidate,
	mimeType: string | undefined,
): boolean {
	const inputs =
		candidate.meta.operations?.["text.generate"]?.modalities?.input;
	if (inputs === undefined)
		return mimeType !== "application/pdf" || candidate.meta.capabilities.vision;
	return mimeType === "application/pdf"
		? inputs.includes("pdf") || inputs.includes("file")
		: inputs.includes("file");
}

function canDeliverFile(
	part: CanonicalFilePart,
	candidate: DeploymentCandidate,
	support: ContentPartInputSupport | undefined,
	mimeType = hintedFileMimeType(part),
): boolean {
	if (
		support === undefined ||
		!mimeMatches(mimeType, support.mimeTypes) ||
		!modelAllowsNativeFile(candidate, mimeType)
	)
		return false;
	const source = fileSource(part);
	if (support.sources.includes(source.kind)) return true;
	return source.kind === "url" && support.sources.includes("data_url");
}

function modelAllowsImage(candidate: DeploymentCandidate): boolean {
	if (!candidate.meta.capabilities.vision) return false;
	const inputs =
		candidate.meta.operations?.["text.generate"]?.modalities?.input;
	return inputs === undefined || inputs.includes("image");
}

function canDeliverImage(
	part: CanonicalImagePart,
	candidate: DeploymentCandidate,
	support: ContentPartInputSupport | undefined,
	mimeType = hintedImageMimeType(part),
): boolean {
	if (
		support === undefined ||
		!modelAllowsImage(candidate) ||
		!mimeMatches(mimeType, support.mimeTypes)
	)
		return false;
	const source = imageSource(part);
	if (support.sources.includes(source.kind)) return true;
	return source.kind === "url" && support.sources.includes("data_url");
}

function isPortableTextMime(mimeType: string): boolean {
	return (
		mimeType.startsWith("text/") ||
		mimeType === "application/json" ||
		mimeType.endsWith("+json") ||
		mimeType === "application/xml" ||
		mimeType.endsWith("+xml") ||
		mimeType === "application/yaml" ||
		PORTABLE_APPLICATION_MIME_TYPES.has(mimeType)
	);
}

function assertPdfSignature(file: MaterializedInput): void {
	if (
		file.mimeType === "application/pdf" &&
		Buffer.from(file.bytes.subarray(0, 1_024)).indexOf("%PDF-", 0, "ascii") < 0
	) {
		throw requestError(
			"A file declared as application/pdf does not have a PDF signature",
			"file_type_mismatch",
			"The file content does not match its declared PDF type.",
		);
	}
}

function assertImageContent(image: MaterializedInput): void {
	if (!image.mimeType.startsWith("image/")) {
		throw requestError(
			`Image input resolved to ${image.mimeType}`,
			"image_type_mismatch",
			"The image content does not match an image media type.",
		);
	}
	const sniffed = sniffMimeType(image.bytes);
	if (
		(sniffed !== undefined && !sniffed.startsWith("image/")) ||
		(SIGNATURED_IMAGE_MIME_TYPES.has(image.mimeType) &&
			sniffed !== image.mimeType)
	) {
		throw requestError(
			`Image input signature resolves to ${sniffed}`,
			"image_type_mismatch",
			"The image content does not match its declared type.",
		);
	}
}

async function extractPortableText(
	file: MaterializedInput,
	signal: AbortSignal,
): Promise<string> {
	signal.throwIfAborted();
	if (file.bytes.byteLength > MAX_MATERIALIZED_INPUT_BYTES) {
		throw candidateInputError(
			`File contains ${file.bytes.byteLength} bytes, above the ${MAX_MATERIALIZED_INPUT_BYTES} byte parser limit`,
			"file_too_large",
			"The file is too large for portable text extraction.",
		);
	}
	assertPdfSignature(file);
	let text: string;
	if (file.mimeType === "application/pdf") {
		const result = await extractPdfText(file.bytes, signal);
		if (!result.ok) {
			if (
				result.code === "too_many_pages" ||
				result.code === "too_many_characters"
			) {
				throw candidateInputError(
					result.code === "too_many_pages"
						? `${result.message}, above the ${MAX_PDF_PAGES} page parser limit`
						: result.message,
					"file_too_large",
					"The PDF is too large for portable text extraction.",
				);
			}
			throw candidateInputError(
				`PDF text extraction failed: ${result.message}`,
				"file_parser_failed",
				"The PDF could not be parsed as text. Use a native document-capable model for this file.",
			);
		}
		text = result.text;
		if (text.trim().length === 0) {
			throw candidateInputError(
				"PDF text extraction returned no text",
				"file_parser_no_text",
				"The PDF contains no extractable text. Use a native or OCR-capable engine.",
			);
		}
	} else if (isPortableTextMime(file.mimeType)) {
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
		} catch (cause) {
			throw candidateInputError(
				`Text file is not valid UTF-8: ${String(cause)}`,
				"file_parser_failed",
				"Portable text files must use UTF-8 encoding.",
			);
		}
	} else {
		throw candidateInputError(
			`No portable parser is available for ${file.mimeType}`,
			"unsupported_file_type",
			`No portable parser is available for ${file.mimeType}. Use a native file-capable model.`,
		);
	}
	if (text.length > MAX_TEXT_CHARACTERS) {
		throw candidateInputError(
			`Parsed file contains ${text.length} characters, above the ${MAX_TEXT_CHARACTERS} character limit`,
			"file_too_large",
			"The extracted file text is too large for portable processing.",
		);
	}
	signal.throwIfAborted();
	return text;
}

type PdfTextResult =
	| { ok: true; text: string; totalPages: number }
	| {
			ok: false;
			code: "too_many_characters" | "too_many_pages" | "parse_failed";
			message: string;
	  };

/** Runs PDF parsing off the event loop and terminates it immediately when the request is aborted. */
async function extractPdfText(
	bytes: Uint8Array,
	signal: AbortSignal,
): Promise<PdfTextResult> {
	signal.throwIfAborted();
	const worker = new Worker(new URL("./pdfTextWorker.ts", import.meta.url));
	const transferred = bytes.slice().buffer;
	return new Promise<PdfTextResult>((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			signal.removeEventListener("abort", onAbort);
			void worker.terminate();
		};
		const finish = (result: PdfTextResult) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(result);
		};
		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(signal.reason);
		};
		worker.once("message", (result: PdfTextResult) => finish(result));
		worker.once("error", (error: Error) =>
			finish({ ok: false, code: "parse_failed", message: error.message }),
		);
		worker.once("exit", (code) => {
			finish({
				ok: false,
				code: "parse_failed",
				message: `PDF parser worker exited before replying (code ${code})`,
			});
		});
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		worker.postMessage(
			{
				bytes: transferred,
				maxCharacters: MAX_TEXT_CHARACTERS,
				maxPages: MAX_PDF_PAGES,
			},
			[transferred],
		);
	});
}

function portableTextPart(
	part: CanonicalFilePart,
	file: MaterializedInput,
	text: string,
): CanonicalContentPart {
	const filename = part.filename ?? file.filename ?? "attachment";
	return {
		type: "text",
		text: `[Attached file: ${JSON.stringify(filename)}; type=${file.mimeType}]\n${text}\n[End attached file]`,
		...(part.cacheControl !== undefined
			? { cacheControl: part.cacheControl }
			: {}),
	};
}

class AsyncSemaphore {
	#available: number;
	readonly #waiters: Array<() => void> = [];

	constructor(limit: number) {
		this.#available = limit;
	}

	async run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.#available === 0) {
			await new Promise<void>((resolve) => this.#waiters.push(resolve));
		} else {
			this.#available -= 1;
		}
		try {
			return await operation();
		} finally {
			const next = this.#waiters.shift();
			if (next) next();
			else this.#available += 1;
		}
	}
}

export class ContentInputResolver {
	readonly #request: CanonicalChatRequest;
	readonly #signal: AbortSignal;
	readonly #dependencies: ResolverDependencies;
	readonly #parts: MaterializablePart[];
	readonly #engine: PdfParserEngine;
	readonly #materialized = new WeakMap<
		MaterializablePart,
		Promise<MaterializedInput>
	>();
	readonly #materializedBySource = new Map<
		string,
		Promise<MaterializedInput>
	>();
	readonly #parsedText = new WeakMap<MaterializedInput, Promise<string>>();
	readonly #accounted = new WeakSet<MaterializablePart>();
	readonly #fetches = new AsyncSemaphore(MAX_CONCURRENT_FETCHES);
	#totalBytes = 0;

	constructor(
		request: CanonicalChatRequest,
		signal: AbortSignal,
		dependencies: ResolverDependencies = DEFAULT_DEPENDENCIES,
	) {
		this.#request = request;
		this.#signal = signal;
		this.#dependencies = dependencies;
		this.#parts = inputParts(request);
		this.#engine = request.fileParser?.pdfEngine ?? "auto";
		for (const part of this.#parts) {
			const source =
				part.type === "file" ? fileSource(part) : imageSource(part);
			if (source.kind === "url") parseSafeHttpsUrl(source.value, part.type);
		}
	}

	get hasInputs(): boolean {
		return this.#parts.length > 0;
	}

	/** True when the request references content whose tokenized size is not represented in its JSON. */
	get hasOpaqueInputs(): boolean {
		return this.#parts.some((part) => {
			const source =
				part.type === "file" ? fileSource(part) : imageSource(part);
			return source.kind !== "data_url";
		});
	}

	assertCandidate(
		candidate: DeploymentCandidate,
		transport: UpstreamTransport,
	): void {
		const transportSupport = candidate.adapter.contentInputs?.[transport];
		for (const part of this.#parts) {
			if (part.type === "image") {
				if (!canDeliverImage(part, candidate, transportSupport?.image)) {
					throw candidateInputError(
						`Adapter ${candidate.adapter.key} cannot deliver this image input on ${transport}`,
						"unsupported_image_input",
						"The selected deployment cannot consume this image input.",
					);
				}
				continue;
			}

			const source = fileSource(part);
			const native = canDeliverFile(part, candidate, transportSupport?.file);
			if (source.kind === "provider_file_id" && !native) {
				throw candidateInputError(
					`Adapter ${candidate.adapter.key} cannot consume this provider file reference`,
					"unsupported_file_reference",
					"The selected deployment cannot consume this provider-scoped file_id.",
				);
			}
			if (this.#engine === "native" && !native) {
				throw candidateInputError(
					`Adapter ${candidate.adapter.key} does not support native file input on ${transport}`,
					"native_file_input_unsupported",
					"The selected deployment does not support the native file-parser engine.",
					"plugins",
				);
			}
		}
	}

	async #materialize(part: MaterializablePart): Promise<MaterializedInput> {
		let pending = this.#materialized.get(part);
		if (pending === undefined) {
			const source =
				part.type === "file" ? fileSource(part) : imageSource(part);
			const filename = part.type === "file" ? part.filename : undefined;
			const sourceKey =
				source.kind === "url"
					? `url:${source.value}`
					: `${part.type}:${source.kind}:${source.value}:${filename ?? ""}`;
			pending = this.#materializedBySource.get(sourceKey);
			if (pending === undefined) {
				pending =
					source.kind === "url"
						? this.#fetches.run(() =>
								fetchInput(
									source.value,
									this.#signal,
									this.#dependencies,
									part.type,
								),
							)
						: source.kind === "data_url"
							? Promise.resolve(
									decodeDataUrl(source.value, filename, part.type),
								)
							: Promise.reject(
									candidateInputError(
										"Provider file IDs cannot be materialized by the gateway",
										"unsupported_file_reference",
										"file_id references require a compatible native upstream.",
									),
								);
				this.#materializedBySource.set(sourceKey, pending);
			}
			this.#materialized.set(part, pending);
		}
		const file = await pending;
		if (!this.#accounted.has(part)) {
			this.#accounted.add(part);
			this.#totalBytes += file.bytes.byteLength;
			if (this.#totalBytes > MAX_PORTABLE_CONTENT_INPUT_BYTES) {
				throw requestError(
					`Materialized content inputs contain ${this.#totalBytes} bytes, above the ${MAX_PORTABLE_CONTENT_INPUT_BYTES} byte request limit`,
					"content_inputs_too_large",
					"The combined content inputs are too large for portable processing.",
				);
			}
		}
		return file;
	}

	async #text(file: MaterializedInput): Promise<string> {
		let pending = this.#parsedText.get(file);
		if (pending === undefined) {
			pending = extractPortableText(file, this.#signal);
			this.#parsedText.set(file, pending);
		}
		return pending;
	}

	async #nativePart(
		part: CanonicalFilePart,
		candidate: DeploymentCandidate,
		support: ContentPartInputSupport,
		metadata: ContentInputResolutionMetadata,
	): Promise<CanonicalFilePart> {
		const source = fileSource(part);
		if (support.sources.includes(source.kind)) {
			if (source.kind === "data_url") {
				const file = await this.#materialize(part);
				assertPdfSignature(file);
				if (
					!mimeMatches(file.mimeType, support.mimeTypes) ||
					!modelAllowsNativeFile(candidate, file.mimeType) ||
					(support.maxBytes !== undefined &&
						file.bytes.byteLength > support.maxBytes)
				) {
					throw candidateInputError(
						`Native file input does not support ${file.mimeType}`,
						"native_file_input_unsupported",
						"The selected deployment does not support this file type natively.",
					);
				}
			}
			metadata.nativeFiles += 1;
			if (source.kind === "url" && part.fileUrl === undefined) {
				const normalized = { ...part, fileUrl: source.value };
				delete normalized.fileData;
				return normalized;
			}
			return { ...part };
		}
		const file = await this.#materialize(part);
		if (
			!support.sources.includes("data_url") ||
			!mimeMatches(file.mimeType, support.mimeTypes) ||
			!modelAllowsNativeFile(candidate, file.mimeType) ||
			(support.maxBytes !== undefined &&
				file.bytes.byteLength > support.maxBytes)
		) {
			throw candidateInputError(
				`Native file input does not support ${file.mimeType}`,
				"native_file_input_unsupported",
				"The selected deployment does not support this file type natively.",
			);
		}
		metadata.materializedFiles += 1;
		metadata.nativeFiles += 1;
		return {
			type: "file",
			fileData: file.dataUrl,
			...((part.filename ?? file.filename)
				? { filename: part.filename ?? file.filename }
				: {}),
			...(part.detail !== undefined ? { detail: part.detail } : {}),
			...(part.cacheControl !== undefined
				? { cacheControl: part.cacheControl }
				: {}),
		};
	}

	async #resolvePart(
		part: CanonicalFilePart,
		candidate: DeploymentCandidate,
		transport: UpstreamTransport,
		metadata: ContentInputResolutionMetadata,
	): Promise<CanonicalContentPart> {
		const support = candidate.adapter.contentInputs?.[transport]?.file;
		const hintedMime = hintedFileMimeType(part);
		const forcePdfText =
			this.#engine === "pdf-text" && hintedMime === "application/pdf";
		if (
			!forcePdfText &&
			support !== undefined &&
			canDeliverFile(part, candidate, support, hintedMime)
		) {
			return this.#nativePart(part, candidate, support, metadata);
		}

		const file = await this.#materialize(part);
		const nativeAfterMaterialization =
			support !== undefined &&
			canDeliverFile(part, candidate, support, file.mimeType);
		if (
			this.#engine !== "pdf-text" &&
			nativeAfterMaterialization &&
			support !== undefined
		) {
			return this.#nativePart(part, candidate, support, metadata);
		}
		if (this.#engine === "native") {
			throw candidateInputError(
				`Adapter ${candidate.adapter.key} cannot consume ${file.mimeType} natively`,
				"native_file_input_unsupported",
				"The selected deployment does not support this file type natively.",
			);
		}

		const text = await this.#text(file);
		metadata.parsedFiles += 1;
		return portableTextPart(part, file, text);
	}

	async #resolveImagePart(
		part: CanonicalImagePart,
		candidate: DeploymentCandidate,
		transport: UpstreamTransport,
		metadata: ContentInputResolutionMetadata,
	): Promise<CanonicalImagePart> {
		const support = candidate.adapter.contentInputs?.[transport]?.image;
		if (support === undefined || !modelAllowsImage(candidate)) {
			throw candidateInputError(
				`Adapter ${candidate.adapter.key} cannot consume image inputs on ${transport}`,
				"unsupported_image_input",
				"The selected deployment cannot consume image inputs.",
			);
		}

		const source = imageSource(part);
		if (support.sources.includes(source.kind)) {
			if (source.kind === "url") {
				metadata.nativeImages += 1;
				return { ...part };
			}
			const image = await this.#materialize(part);
			assertImageContent(image);
			if (
				!mimeMatches(image.mimeType, support.mimeTypes) ||
				(support.maxBytes !== undefined &&
					image.bytes.byteLength > support.maxBytes)
			) {
				throw candidateInputError(
					`Native image input does not support ${image.mimeType}`,
					"unsupported_image_input",
					"The selected deployment does not support this image type natively.",
				);
			}
			metadata.nativeImages += 1;
			return { ...part, url: image.dataUrl };
		}

		if (source.kind !== "url" || !support.sources.includes("data_url")) {
			throw candidateInputError(
				`Adapter ${candidate.adapter.key} cannot deliver this image source on ${transport}`,
				"unsupported_image_input",
				"The selected deployment cannot consume this image source.",
			);
		}
		const image = await this.#materialize(part);
		assertImageContent(image);
		if (
			!mimeMatches(image.mimeType, support.mimeTypes) ||
			(support.maxBytes !== undefined &&
				image.bytes.byteLength > support.maxBytes)
		) {
			throw candidateInputError(
				`Materialized image input does not support ${image.mimeType}`,
				"unsupported_image_input",
				"The selected deployment does not support this image type.",
			);
		}
		metadata.materializedImages += 1;
		metadata.nativeImages += 1;
		return { ...part, url: image.dataUrl };
	}

	async resolveForCandidate(
		candidate: DeploymentCandidate,
		transport: UpstreamTransport,
	): Promise<ResolvedContentInputRequest> {
		if (!this.hasInputs) return { request: this.#request };
		const metadata: ContentInputResolutionMetadata = {
			pdfEngine: this.#engine,
			materializedFiles: 0,
			materializedImages: 0,
			nativeFiles: 0,
			nativeImages: 0,
			parsedFiles: 0,
		};
		const messages = await Promise.all(
			this.#request.messages.map(async (message) => {
				if (!Array.isArray(message.content)) return message;
				const content = await Promise.all(
					message.content.map((part) =>
						part.type === "file"
							? this.#resolvePart(part, candidate, transport, metadata)
							: part.type === "image"
								? this.#resolveImagePart(part, candidate, transport, metadata)
								: Promise.resolve(part),
					),
				);
				return { ...message, content };
			}),
		);
		return { request: { ...this.#request, messages }, metadata };
	}
}

export function createContentInputResolver(
	request: CanonicalChatRequest,
	signal: AbortSignal,
	dependencies?: Partial<ResolverDependencies>,
): ContentInputResolver {
	return new ContentInputResolver(request, signal, {
		...DEFAULT_DEPENDENCIES,
		...dependencies,
	});
}
