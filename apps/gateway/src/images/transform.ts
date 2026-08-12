import type { ExtensionImageOutput } from "#extensions/sdk.ts";
import { GatewayError } from "#core/errors.ts";
import sharp from "sharp";

import type {
	CanonicalImageStreamEvent,
	CanonicalImageResponse,
	CanonicalImageRequest,
	CanonicalImageData,
	ImageModelProfile,
	ImageOutputFormat,
} from "#core/images.ts";

const MIME_BY_FORMAT: Record<
	ImageOutputFormat,
	ExtensionImageOutput["mimeType"]
> = {
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp",
};

interface ImageTransformHooks {
	applyImageOutput?(
		output: ExtensionImageOutput,
	): Promise<ExtensionImageOutput>;
}

function formatFromMime(
	mime: string | undefined,
): ImageOutputFormat | undefined {
	if (mime === "image/png") return "png";
	if (mime === "image/jpeg") return "jpeg";
	if (mime === "image/webp") return "webp";
	return undefined;
}

function decodeBase64(value: string): Buffer {
	const raw = value.replace(/^data:[^;]+;base64,/, "");
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) {
		throw new GatewayError({
			class: "server",
			message: "Upstream returned invalid base64 image data",
		});
	}
	return Buffer.from(raw, "base64");
}

async function transformImageData(
	image: CanonicalImageData,
	req: CanonicalImageRequest,
	profile?: ImageModelProfile,
	hooks?: ImageTransformHooks,
): Promise<CanonicalImageData> {
	if (!image.b64Json)
		throw new GatewayError({
			class: "server",
			message: "Upstream returned an empty image",
		});

	const input = decodeBase64(image.b64Json);
	let pipeline = sharp(input, {
		limitInputPixels: 100_000_000,
		animated: false,
	});
	const before = await pipeline.metadata();
	if (
		!before.width ||
		!before.height ||
		!["png", "jpeg", "webp"].includes(before.format ?? "")
	) {
		throw new GatewayError({
			class: "server",
			message: "Upstream returned an unsupported image format",
		});
	}

	const outputFormat = req.outputFormat ?? (before.format as ImageOutputFormat);
	const applyLocalCompression =
		req.outputCompression !== undefined &&
		outputFormat !== "png" &&
		profile?.nativeOutputCompression === false;
	const quality = applyLocalCompression ? req.outputCompression : 100;

	// Re-encoding is always intentional: Sharp discards all upstream metadata by default.
	pipeline = pipeline.autoOrient();
	if (outputFormat === "jpeg") pipeline = pipeline.jpeg({ quality });
	else if (outputFormat === "webp") pipeline = pipeline.webp({ quality });
	else pipeline = pipeline.png();
	let output = await pipeline.toBuffer();

	let after = await sharp(output, {
		limitInputPixels: 100_000_000,
	}).metadata();
	let format = after.format as ImageOutputFormat;
	if (hooks?.applyImageOutput) {
		const mimeType = MIME_BY_FORMAT[format];
		const width = after.width;
		const height = after.height;
		if (!width || !height || !mimeType) {
			throw new GatewayError({
				class: "server",
				message: "Image transform produced an unsupported output format",
			});
		}
		const transformed = await hooks.applyImageOutput({
			data: output,
			mimeType,
			format,
			width,
			height,
		});
		output = Buffer.from(transformed.data);
		after = await sharp(output, {
			limitInputPixels: 100_000_000,
		}).metadata();
		format = after.format as ImageOutputFormat;
	}
	if (req.background === "transparent" && !after.hasAlpha) {
		throw new GatewayError({
			class: "server",
			message:
				"Upstream did not return an alpha channel for transparent output",
		});
	}
	if (
		req.size &&
		req.size !== "auto" &&
		`${after.width}x${after.height}` !== req.size
	) {
		throw new GatewayError({
			class: "server",
			message: `Upstream returned ${after.width}x${after.height}, expected ${req.size}`,
			code: "upstream_image_size_mismatch",
		});
	}
	if (!MIME_BY_FORMAT[format]) {
		throw new GatewayError({
			class: "server",
			message: "Image extension produced an unsupported output format",
		});
	}
	return {
		...image,
		b64Json: output.toString("base64"),
		mimeType: MIME_BY_FORMAT[format],
		width: after.width,
		height: after.height,
	};
}

export async function transformImageResponse(
	response: CanonicalImageResponse,
	req: CanonicalImageRequest,
	profile?: ImageModelProfile,
	hooks?: ImageTransformHooks,
): Promise<CanonicalImageResponse> {
	const data = await Promise.all(
		response.data.map((image) =>
			transformImageData(image, req, profile, hooks),
		),
	);
	const first = data[0];
	const actualFormat =
		req.outputFormat ??
		response.outputFormat ??
		formatFromMime(first?.mimeType);
	return {
		...response,
		data,
		...(first?.width && first.height
			? { size: `${first.width}x${first.height}` }
			: {}),
		...(actualFormat ? { outputFormat: actualFormat } : {}),
	};
}

export async function transformImageEvent(
	event: CanonicalImageStreamEvent,
	req: CanonicalImageRequest,
	profile?: ImageModelProfile,
	hooks?: ImageTransformHooks,
): Promise<CanonicalImageStreamEvent> {
	const image = await transformImageData(event.image, req, profile, hooks);
	const outputFormat =
		req.outputFormat ?? event.outputFormat ?? formatFromMime(image.mimeType);
	return { ...event, image, ...(outputFormat ? { outputFormat } : {}) };
}
