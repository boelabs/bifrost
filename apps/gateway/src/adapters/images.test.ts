import { openaicompatibleAdapter } from "./openaicompatible/index.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { openaiAdapter } from "./openai/index.ts";
import { googleAdapter } from "./google/index.ts";
import type { AdapterContext } from "./types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

import {
	type CanonicalImageRequest,
	type CanonicalImageInput,
	type ImageModelProfile,
	resolveImageSize,
} from "#core/images.ts";

const profile: ImageModelProfile = {
	maxN: 10,
	maxInputImages: 16,
	supportsNativeStreaming: true,
	outputFormats: ["png", "webp", "jpeg"],
	responseFormats: ["b64_json"],
	sizes: { "1024x1024": { aspectRatio: "1:1", imageSize: "1K" } },
};

function ctx(
	transport: AdapterContext["transport"],
	adapter = "openai",
): AdapterContext {
	return {
		upstreamModel: "upstream-image",
		transport: transport,
		credentials:
			adapter === "google"
				? { apiKey: "google" }
				: { apiKey: "sk", baseUrl: "https://example.test/v1" },
		meta: {
			capabilities: {
				tools: false,
				vision: true,
				reasoning: false,
				structuredOutputs: false,
			},
			supportedCallTypes: ["images.generations", "images.edits"],
			image: profile,
		},
		requestId: "req",
	};
}

const generation: CanonicalImageRequest = {
	operation: "generation",
	model: "public",
	prompt: "draw",
	stream: false,
	size: "1024x1024",
	outputFormat: "webp",
	extraBody: { seed: 7 },
};

async function fixture(): Promise<{ dir: string; input: CanonicalImageInput }> {
	const dir = await mkdtemp(join(tmpdir(), "image-adapter-test-"));
	const path = join(dir, "input.png");
	const bytes = await sharp({
		create: { width: 8, height: 8, channels: 4, background: "red" },
	})
		.png()
		.toBuffer();
	await writeFile(path, bytes);
	return {
		dir,
		input: {
			path,
			filename: "input.png",
			mimeType: "image/png",
			sizeBytes: bytes.length,
			width: 8,
			height: 8,
		},
	};
}

test("OpenAI images: direct generation builds /images/generations and parses usage", async () => {
	const request = await openaiAdapter.imageGeneration!.buildRequest(
		generation,
		ctx("images"),
	);
	assert.equal(request.url, "https://example.test/v1/images/generations");
	const body = JSON.parse(request.body as string);
	assert.equal(body.model, "upstream-image");
	assert.equal(body.output_format, "webp");
	assert.equal(body.response_format, "b64_json");
	assert.equal(body.seed, 7);
	const response = await openaiAdapter.imageGeneration!.parseResponse(
		{
			created: 1,
			data: [{ b64_json: "YWJj" }],
			usage: {
				input_tokens: 2,
				output_tokens: 3,
				total_tokens: 5,
				input_tokens_details: { image_tokens: 0, text_tokens: 2 },
			},
		},
		ctx("images"),
	);
	assert.equal(response.data[0]?.b64Json, "YWJj");
	assert.equal(response.usage?.totalTokens, 5);
	assert.throws(
		() =>
			openaiAdapter.imageGeneration!.parseResponse(
				{
					created: 1,
					data: [{ url: "https://example.test/image.png" }],
				},
				ctx("images"),
			),
		/required b64_json/,
	);
});

test("OpenAI Images legacy: does not forward controls processed locally by the gateway", async () => {
	const legacyCtx = ctx("images");
	legacyCtx.meta.image = {
		...profile,
		nativeOutputFormat: false,
		nativeOutputCompression: false,
	};
	const request = await openaiAdapter.imageGeneration!.buildRequest(
		{
			...generation,
			outputFormat: "webp",
			outputCompression: 80,
		},
		legacyCtx,
	);
	const body = JSON.parse(request.body as string);
	assert.equal(body.output_format, undefined);
	assert.equal(body.output_compression, undefined);
	assert.equal(body.response_format, "b64_json");
});

test("OpenAI Images without native stream lets the gateway synthesize the final event", async () => {
	const syntheticCtx = ctx("images");
	syntheticCtx.meta.image = { ...profile, supportsNativeStreaming: false };
	const request = await openaiAdapter.imageGeneration!.buildRequest(
		{
			...generation,
			stream: true,
		},
		syntheticCtx,
	);
	const body = JSON.parse(request.body as string);
	assert.equal(body.stream, undefined);
	assert.equal(body.partial_images, undefined);
});

test("OpenAI images: direct edit uses multipart and preserves filename", async () => {
	const { dir, input } = await fixture();
	try {
		const request = await openaiAdapter.imageEdit!.buildRequest(
			{
				operation: "edit",
				model: "public",
				prompt: "edit",
				images: [input],
				stream: false,
			},
			ctx("images"),
		);
		assert.equal(request.url, "https://example.test/v1/images/edits");
		assert.equal("content-type" in request.headers, false);
		assert.ok(request.body instanceof FormData);
		assert.equal(request.body.get("model") as string, "upstream-image");
		assert.equal(request.body.get("response_format") as string, "b64_json");
		assert.equal(request.body.getAll("image").length, 1);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("OpenAI images: normalizes partial/completed SSE events", async () => {
	const sse = [
		'data: {"type":"image_generation.partial_image","b64_json":"YWJj","partial_image_index":0,"created_at":1}\n\n',
		'data: {"type":"image_generation.completed","b64_json":"ZGVm","created_at":2,"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}\n\n',
	].join("");
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(sse));
			controller.close();
		},
	});
	const events = [];
	for await (const event of openaiAdapter.imageGeneration!.parseStream!(
		stream,
		ctx("images"),
	))
		events.push(event);
	assert.equal(events[0]?.kind, "partial");
	assert.equal(events[1]?.kind, "completed");
	assert.equal(
		events[1]?.kind === "completed" ? events[1].usage?.totalTokens : null,
		3,
	);
});

test("OpenAI-compatible omni: uses chat/completions, modalities, and extensible image_config", async () => {
	const { dir, input } = await fixture();
	try {
		const request = await openaicompatibleAdapter.imageEdit!.buildRequest(
			{
				operation: "edit",
				model: "public",
				prompt: "edit",
				images: [input],
				stream: false,
				size: "1024x1024",
				extraBody: { image_config: { strength: 0.7 } },
			},
			ctx("chat_completions"),
		);
		const body = JSON.parse(request.body as string);
		assert.deepEqual(body.modalities, ["image", "text"]);
		assert.equal(body.image_config.aspect_ratio, "1:1");
		assert.equal(body.image_config.strength, 0.7);
		assert.match(
			body.messages[0].content[1].image_url.url,
			/^data:image\/png;base64,/,
		);
		const response = await openaicompatibleAdapter.imageEdit!.parseResponse(
			{
				created: 2,
				choices: [
					{
						message: {
							images: [{ image_url: { url: "data:image/png;base64,YWJj" } }],
						},
					},
				],
			},
			ctx("chat_completions"),
		);
		assert.equal(response.data[0]?.b64Json, "YWJj");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("Gemini images: generateContent emits IMAGE config and parses inlineData", async () => {
	const request = await googleAdapter.imageGeneration!.buildRequest(
		generation,
		ctx("generate_content", "google"),
	);
	const body = JSON.parse(request.body as string);
	assert.deepEqual(body.generationConfig.responseModalities, ["IMAGE"]);
	assert.equal(body.generationConfig.imageConfig.aspectRatio, "1:1");
	assert.equal(body.seed, 7);
	const response = await googleAdapter.imageGeneration!.parseResponse(
		{
			candidates: [
				{
					content: {
						parts: [{ inlineData: { mimeType: "image/png", data: "YWJj" } }],
					},
				},
			],
			usageMetadata: {
				promptTokenCount: 2,
				candidatesTokenCount: 3,
				totalTokenCount: 5,
			},
		},
		ctx("generate_content", "google"),
	);
	assert.equal(response.data[0]?.mimeType, "image/png");
	assert.equal(response.usage?.totalTokens, 5);
});

test("resolveImageSize: auto resolves to autoSize natively or the first profile size", () => {
	const table: ImageModelProfile = {
		sizes: {
			"1024x1024": { aspectRatio: "1:1", imageSize: "1K" },
			"848x1264": { aspectRatio: "2:3", imageSize: "1K" },
		},
	};
	assert.deepEqual(resolveImageSize({ size: "848x1264" }, table), {
		size: "848x1264",
		aspectRatio: "2:3",
		imageSize: "1K",
	});
	// No native auto: auto and omitted fall back to the first (default) size.
	for (const req of [{ size: "auto" }, {}]) {
		assert.deepEqual(resolveImageSize(req, table), {
			size: "1024x1024",
			aspectRatio: "1:1",
			imageSize: "1K",
		});
	}
	// Native auto: forward auto, plus any explicit native translation.
	assert.deepEqual(
		resolveImageSize({ size: "auto" }, { ...table, autoSize: {} }),
		{
			size: "auto",
		},
	);
	assert.deepEqual(
		resolveImageSize({}, { ...table, autoSize: { aspectRatio: "auto" } }),
		{ size: "auto", aspectRatio: "auto" },
	);
	// Nothing declared: nothing to send.
	assert.equal(resolveImageSize({ size: "auto" }, {}), undefined);
	assert.equal(resolveImageSize({}, undefined), undefined);
});

test("OpenAI images: size auto forwards auto natively or the first profile size", async () => {
	const { size: _, ...withoutSize } = generation;
	const nativeCtx = ctx("images");
	nativeCtx.meta.image = { ...profile, autoSize: {} };
	for (const req of [{ ...generation, size: "auto" }, withoutSize]) {
		const request = await openaiAdapter.imageGeneration!.buildRequest(
			req,
			nativeCtx,
		);
		assert.equal(JSON.parse(request.body as string).size, "auto");
	}
	const fallbackRequest = await openaiAdapter.imageGeneration!.buildRequest(
		{ ...generation, size: "auto" },
		ctx("images"),
	);
	assert.equal(JSON.parse(fallbackRequest.body as string).size, "1024x1024");
});

test("Gemini images: size auto omits imageConfig natively or maps the first profile size", async () => {
	const nativeCtx = ctx("generate_content", "google");
	nativeCtx.meta.image = { ...profile, autoSize: {} };
	const nativeRequest = await googleAdapter.imageGeneration!.buildRequest(
		{ ...generation, size: "auto" },
		nativeCtx,
	);
	const nativeBody = JSON.parse(nativeRequest.body as string);
	assert.equal(nativeBody.generationConfig.imageConfig, undefined);

	const { size: _, ...withoutSize } = generation;
	const fallbackRequest = await googleAdapter.imageGeneration!.buildRequest(
		withoutSize,
		ctx("generate_content", "google"),
	);
	const fallbackBody = JSON.parse(fallbackRequest.body as string);
	assert.equal(fallbackBody.generationConfig.imageConfig.aspectRatio, "1:1");
	assert.equal(fallbackBody.generationConfig.imageConfig.imageSize, "1K");
});

test("Gemini 3.1 images: quality controls thinkingLevel; auto/low/omitted use minimal", async () => {
	const googleCtx = ctx("generate_content", "google");
	googleCtx.meta.image = {
		...profile,
		qualities: ["auto", "low", "high"],
		qualityMappings: {
			auto: { thinkingLevel: "minimal" },
			low: { thinkingLevel: "minimal" },
			high: { thinkingLevel: "high" },
		},
	};

	for (const [quality, expected] of [
		[undefined, "minimal"],
		["auto", "minimal"],
		["low", "minimal"],
		["high", "high"],
	] as const) {
		const request = await googleAdapter.imageGeneration!.buildRequest(
			{
				...generation,
				...(quality ? { quality } : {}),
			},
			googleCtx,
		);
		const body = JSON.parse(request.body as string);
		assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, expected);
	}
});
