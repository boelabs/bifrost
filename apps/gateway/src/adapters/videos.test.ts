import { assertVideoRequestSupported } from "#gateway/videoRequestValidation.ts";
import { sanitizeVideoRequestBody, resolveVideoSize } from "#core/videos.ts";
import { jsonResponse, withStubbedFetch } from "#test-support/fetch.ts";
import { openaicompatibleAdapter } from "./openaicompatible/index.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import { googleAdapter } from "./google/index.ts";
import { openaiAdapter } from "./openai/index.ts";
import type { AdapterContext } from "./types.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	videoCreateRequestSchema,
	videoCreateToCanonical,
} from "#contracts/openai/videos.ts";

function meta(overrides: Record<string, unknown> = {}): AdapterContext["meta"] {
	return {
		capabilities: {
			tools: false,
			vision: true,
			reasoning: false,
			structuredOutputs: false,
		},
		operations: {
			"video.generate": {
				durations: ["8"],
				sizes: {
					"1280x720": {
						aspectRatio: "16:9",
						resolution: "720p",
					},
				},
				supportsImageUrl: true,
				...overrides,
			},
		},
	};
}

function ctx(
	transport: AdapterContext["transport"],
	profileOverrides: Record<string, unknown> = {},
): AdapterContext {
	return {
		upstreamModel: "google/veo-3.1",
		credentials: {
			apiKey: "k",
			baseUrl: "https://api.aggregator.example/v1",
		},
		transport,
		requestId: "req",
		meta: meta(profileOverrides),
	};
}

test("async videos transport submits, polls, and downloads with upstream job id", async () => {
	const calls: Array<{ url: string; method: string; body?: unknown }> = [];
	await withStubbedFetch(
		async (input, init) => {
			const url = String(input);
			calls.push({
				url,
				method: init?.method ?? "GET",
				...(typeof init?.body === "string"
					? { body: JSON.parse(init.body) as unknown }
					: {}),
			});
			if (url.endsWith("/videos") && init?.method === "POST") {
				return jsonResponse(
					{
						id: "job-abc123",
						generation_id: "gen-xyz789",
						polling_url: "/api/v1/videos/job-abc123",
						status: "pending",
					},
					202,
				);
			}
			if (url.endsWith("/videos/job-abc123")) {
				return jsonResponse({
					id: "job-abc123",
					generation_id: "gen-xyz789",
					status: "completed",
					usage: { cost: 0.5 },
				});
			}
			if (url.endsWith("/videos/job-abc123/content?index=0")) {
				return new Response("mp4", {
					headers: { "content-type": "video/mp4", "content-length": "3" },
				});
			}
			return jsonResponse({ error: "unexpected" }, 500);
		},
		async () => {
			const handler = openaicompatibleAdapter.videoGeneration!;
			const create = await handler.submit(
				{
					model: "veo",
					prompt: "mountain",
					seconds: "8",
					size: "1280x720",
				},
				ctx("videos_async"),
			);
			assert.equal(create.upstreamJobId, "job-abc123");
			assert.equal(create.status, "queued");

			const refreshed = await handler.refresh(
				{ upstreamJobId: create.upstreamJobId },
				ctx("videos_async"),
			);
			assert.equal(refreshed.status, "completed");
			assert.deepEqual(refreshed.usage, { cost: 0.5 });

			const content = await handler.download(
				{ upstreamJobId: create.upstreamJobId },
				"video",
				ctx("videos_async"),
			);
			assert.equal(content.contentType, "video/mp4");
			assert.equal(content.contentLength, 3);
		},
	);

	// The profile maps 1280x720 to a native aspect_ratio/resolution pair, so the exact size is
	// not repeated alongside it.
	assert.deepEqual(calls[0]?.body, {
		model: "google/veo-3.1",
		prompt: "mountain",
		duration: 8,
		aspect_ratio: "16:9",
		resolution: "720p",
	});
	assert.equal(
		calls[1]?.url,
		"https://api.aggregator.example/v1/videos/job-abc123",
	);
	assert.equal(
		calls[2]?.url,
		"https://api.aggregator.example/v1/videos/job-abc123/content?index=0",
	);
});

test("async videos transport forwards seed, audio, references, and frame images", async () => {
	let body: Record<string, unknown> | undefined;
	await withStubbedFetch(
		(_input, init) => {
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return jsonResponse({ id: "job-1", status: "pending" }, 202);
		},
		async () => {
			await openaicompatibleAdapter.videoGeneration!.submit(
				{
					model: "veo",
					prompt: "city",
					aspectRatio: "9:16",
					resolution: "1080p",
					seed: 42,
					generateAudio: true,
					inputReferences: [
						{ type: "image_url", url: "https://x/img.png" },
						{ type: "audio_url", url: "https://x/a.mp3" },
					],
					frameImages: [{ frame: "last", url: "https://x/last.png" }],
				},
				ctx("videos_async"),
			);
		},
	);
	assert.deepEqual(body, {
		model: "google/veo-3.1",
		prompt: "city",
		aspect_ratio: "9:16",
		resolution: "1080p",
		seed: 42,
		generate_audio: true,
		input_references: [
			{ type: "image_url", image_url: { url: "https://x/img.png" } },
			{ type: "audio_url", audio_url: { url: "https://x/a.mp3" } },
		],
		frame_images: [
			{
				type: "image_url",
				image_url: { url: "https://x/last.png" },
				frame_type: "last_frame",
			},
		],
	});
});

test("async videos transport maps cancelled/expired to failed and keeps polling unknown statuses", async () => {
	const handler = openaicompatibleAdapter.videoGeneration!;
	const statuses: Array<[string, string]> = [
		["cancelled", "failed"],
		["expired", "failed"],
		["some_future_state", "in_progress"],
	];
	for (const [upstream, expected] of statuses) {
		await withStubbedFetch(
			() => jsonResponse({ id: "job-1", status: upstream }),
			async () => {
				const job = await handler.refresh(
					{ upstreamJobId: "job-1" },
					ctx("videos_async"),
				);
				assert.equal(job.status, expected, `status ${upstream}`);
			},
		);
	}
});

test("openai video transport uses native variant query and deletes upstream", async () => {
	const calls: Array<{ url: string; method: string }> = [];
	await withStubbedFetch(
		(input, init) => {
			calls.push({ url: String(input), method: init?.method ?? "GET" });
			if (init?.method === "POST") {
				return jsonResponse({ id: "vid_upstream", status: "queued" });
			}
			if (init?.method === "DELETE") {
				return jsonResponse({ id: "vid_upstream", deleted: true });
			}
			return new Response("jpg", {
				headers: { "content-type": "image/jpeg", "content-length": "3" },
			});
		},
		async () => {
			const handler = openaiAdapter.videoGeneration!;
			const openaiCtx: AdapterContext = {
				...ctx("videos"),
				upstreamModel: "sora-2",
				credentials: { apiKey: "k" },
			};
			const job = await handler.submit(
				{ model: "sora", prompt: "city", seconds: "4", size: "1280x720" },
				openaiCtx,
			);
			await handler.download(
				{ upstreamJobId: job.upstreamJobId },
				"thumbnail",
				openaiCtx,
			);
			await handler.remove!({ upstreamJobId: job.upstreamJobId }, openaiCtx);
		},
	);
	assert.equal(calls[0]?.url, "https://api.openai.com/v1/videos");
	assert.equal(
		calls[1]?.url,
		"https://api.openai.com/v1/videos/vid_upstream/content?variant=thumbnail",
	);
	assert.deepEqual(calls[2], {
		url: "https://api.openai.com/v1/videos/vid_upstream",
		method: "DELETE",
	});
});

test("openai video transport rejects multiple references and never sends user", async () => {
	const handler = openaiAdapter.videoGeneration!;
	const openaiCtx: AdapterContext = {
		...ctx("videos"),
		upstreamModel: "sora-2",
		credentials: { apiKey: "k" },
	};
	await assert.rejects(
		handler.submit(
			{
				model: "sora",
				prompt: "x",
				inputReferences: [
					{ type: "image_url", url: "https://x/1.png" },
					{ type: "image_url", url: "https://x/2.png" },
				],
			},
			openaiCtx,
		),
		(err: unknown) =>
			err instanceof GatewayError && err.class === "bad_request",
	);

	let body: Record<string, unknown> | undefined;
	await withStubbedFetch(
		(_input, init) => {
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return jsonResponse({ id: "vid_1", status: "queued" });
		},
		async () => {
			await handler.submit(
				{ model: "sora", prompt: "x", seconds: "4", user: "tenant-7" },
				openaiCtx,
			);
		},
	);
	assert.equal(body?.user, undefined);
	assert.equal(body?.seconds, "4");
});

test("google veo transport builds predictLongRunning bodies with frames and seed", async () => {
	const calls: Array<{ url: string; body?: unknown }> = [];
	const dataUrl = `data:image/png;base64,${"A".repeat(8)}`;
	await withStubbedFetch(
		(input, init) => {
			calls.push({
				url: String(input),
				...(typeof init?.body === "string"
					? { body: JSON.parse(init.body) as unknown }
					: {}),
			});
			return jsonResponse({ name: "models/veo-3.1/operations/op1" });
		},
		async () => {
			const job = await googleAdapter.videoGeneration!.submit(
				{
					model: "veo-3.1",
					prompt: "sunrise",
					seconds: "8",
					size: "1280x720",
					seed: 7,
					frameImages: [{ frame: "last", url: dataUrl }],
				},
				{
					...ctx("generate_videos"),
					upstreamModel: "veo-3.1-generate-preview",
				},
			);
			assert.equal(job.upstreamJobId, "models/veo-3.1/operations/op1");
			assert.equal(job.status, "queued");
		},
	);
	assert.match(
		calls[0]!.url,
		/models\/veo-3\.1-generate-preview:predictLongRunning$/,
	);
	assert.deepEqual(calls[0]!.body, {
		instances: [
			{
				prompt: "sunrise",
				lastFrame: {
					inlineData: { mimeType: "image/png", data: "A".repeat(8) },
				},
			},
		],
		parameters: {
			durationSeconds: 8,
			aspectRatio: "16:9",
			resolution: "720p",
			seed: 7,
		},
	});
});

test("google veo transport maps multiple image references to referenceImages", async () => {
	const calls: Array<{ body?: unknown }> = [];
	await withStubbedFetch(
		(_input, init) => {
			calls.push({
				...(typeof init?.body === "string"
					? { body: JSON.parse(init.body) as unknown }
					: {}),
			});
			return jsonResponse({ name: "models/veo-3.1/operations/op1" });
		},
		async () => {
			await googleAdapter.videoGeneration!.submit(
				{
					model: "veo-3.1",
					prompt: "fashion lagoon",
					seconds: "8",
					inputReferences: [
						{ type: "image_url", url: "data:image/png;base64,AAA" },
						{ type: "image_url", url: "data:image/jpeg;base64,BBB" },
					],
				},
				{
					...ctx("generate_videos"),
					upstreamModel: "veo-3.1-generate-preview",
				},
			);
		},
	);
	assert.deepEqual(calls[0]!.body, {
		instances: [
			{
				prompt: "fashion lagoon",
				referenceImages: [
					{
						image: { inlineData: { mimeType: "image/png", data: "AAA" } },
						referenceType: "asset",
					},
					{
						image: { inlineData: { mimeType: "image/jpeg", data: "BBB" } },
						referenceType: "asset",
					},
				],
			},
		],
		parameters: { durationSeconds: 8 },
	});
});

test("google veo transport maps video references to extension input", async () => {
	const calls: Array<{ body?: unknown }> = [];
	await withStubbedFetch(
		(_input, init) => {
			calls.push({
				...(typeof init?.body === "string"
					? { body: JSON.parse(init.body) as unknown }
					: {}),
			});
			return jsonResponse({ name: "models/veo-3.1/operations/op1" });
		},
		async () => {
			await googleAdapter.videoGeneration!.submit(
				{
					model: "veo-3.1",
					prompt: "extend the scene",
					resolution: "720p",
					inputReferences: [
						{ type: "video_url", url: "data:video/mp4;base64,VID" },
					],
				},
				{
					...ctx("generate_videos"),
					upstreamModel: "veo-3.1-generate-preview",
				},
			);
		},
	);
	assert.deepEqual(calls[0]!.body, {
		instances: [
			{
				prompt: "extend the scene",
				video: { inlineData: { mimeType: "video/mp4", data: "VID" } },
			},
		],
		parameters: { aspectRatio: "16:9", resolution: "720p" },
	});
});

test("google veo transport rejects non-8s high-resolution constrained requests", async () => {
	await withStubbedFetch(
		() => jsonResponse({ name: "models/veo-3.1/operations/op1" }),
		async () => {
			await assert.rejects(
				googleAdapter.videoGeneration!.submit(
					{
						model: "veo-3.1",
						prompt: "cinematic",
						seconds: "4",
						resolution: "4K",
						aspectRatio: "16:9",
					},
					{
						...ctx("generate_videos", {
							sizes: {
								"3840x2160": {
									aspectRatio: "16:9",
									resolution: "4k",
								},
							},
						}),
						upstreamModel: "veo-3.1-generate-preview",
					},
				),
				/duration/,
			);
		},
	);
});

test("contract normalizes aggregator-style and OpenAI request shapes to one canonical form", () => {
	const aggregatorStyle = videoCreateToCanonical(
		videoCreateRequestSchema.parse({
			model: "m",
			prompt: "p",
			duration: 8,
			aspect_ratio: "16:9",
			resolution: "720p",
			seed: 1,
			generate_audio: false,
			input_references: [
				{ type: "image_url", image_url: { url: "https://x/i.png" } },
			],
		}),
	);
	assert.equal(aggregatorStyle.seconds, "8");
	assert.equal(aggregatorStyle.aspectRatio, "16:9");
	assert.equal(aggregatorStyle.resolution, "720p");
	assert.equal(aggregatorStyle.seed, 1);
	assert.equal(aggregatorStyle.generateAudio, false);
	assert.deepEqual(aggregatorStyle.inputReferences, [
		{ type: "image_url", url: "https://x/i.png" },
	]);

	const openaiStyle = videoCreateToCanonical(
		videoCreateRequestSchema.parse({
			model: "m",
			prompt: "p",
			seconds: "4",
			size: "1280x720",
			input_reference: { file_id: "file_1" },
		}),
	);
	assert.equal(openaiStyle.seconds, "4");
	assert.equal(openaiStyle.size, "1280x720");
	assert.deepEqual(openaiStyle.inputReferences, [
		{ type: "file_id", fileId: "file_1" },
	]);

	assert.throws(() =>
		videoCreateRequestSchema.parse({
			model: "m",
			prompt: "p",
			seconds: "4",
			duration: 4,
		}),
	);
	assert.throws(() =>
		videoCreateRequestSchema.parse({
			model: "m",
			prompt: "p",
			size: "1280x720",
			aspect_ratio: "16:9",
		}),
	);
});

test("validation gates parameters by model profile", () => {
	const resolved = meta() as unknown as ResolvedModelMetadata;
	const base = { model: "m", prompt: "p" };
	assert.doesNotThrow(() =>
		assertVideoRequestSupported(
			{ ...base, aspectRatio: "16:9", resolution: "720p" },
			resolved,
		),
	);
	assert.throws(
		() =>
			assertVideoRequestSupported({ ...base, aspectRatio: "21:9" }, resolved),
		/aspect_ratio/,
	);
	assert.throws(
		() => assertVideoRequestSupported({ ...base, seed: 3 }, resolved),
		/seed/,
	);
	assert.throws(
		() =>
			assertVideoRequestSupported({ ...base, generateAudio: true }, resolved),
		/generate_audio/,
	);
	assert.throws(
		() =>
			assertVideoRequestSupported(
				{
					...base,
					frameImages: [{ frame: "first", url: "https://x/f.png" }],
				},
				resolved,
			),
		/frame images/,
	);
	assert.doesNotThrow(() =>
		assertVideoRequestSupported(
			{ ...base, seed: 3 },
			meta({ supportsSeed: true }) as unknown as ResolvedModelMetadata,
		),
	);
});

test("resolveVideoSize reverse-maps aspect ratio and resolution to exact sizes", () => {
	const profile = {
		sizes: {
			"1280x720": { aspectRatio: "16:9", resolution: "720p" },
			"720x1280": { aspectRatio: "9:16", resolution: "720p" },
			"3840x2160": { aspectRatio: "16:9", resolution: "4k" },
		},
	};
	assert.deepEqual(resolveVideoSize({ size: "1280x720" }, profile), {
		size: "1280x720",
		aspectRatio: "16:9",
		resolution: "720p",
	});
	assert.deepEqual(
		resolveVideoSize({ aspectRatio: "9:16", resolution: "720p" }, profile),
		{ size: "720x1280", aspectRatio: "9:16", resolution: "720p" },
	);
	assert.deepEqual(
		resolveVideoSize({ aspectRatio: "16:9", resolution: "4K" }, profile),
		{ size: "3840x2160", aspectRatio: "16:9", resolution: "4k" },
	);
	assert.equal(
		resolveVideoSize({ aspectRatio: "21:9" }, profile)?.size,
		undefined,
	);
	assert.equal(resolveVideoSize({}, profile), undefined);
});

test("sanitizeVideoRequestBody redacts large data URLs anywhere in the body", () => {
	const bigDataUrl = `data:image/png;base64,${"A".repeat(5000)}`;
	const sanitized = sanitizeVideoRequestBody({
		prompt: "keep me",
		input_reference: { image_url: bigDataUrl },
		extra_body: { nested: [{ image: bigDataUrl }] },
	}) as Record<string, unknown>;
	assert.equal(sanitized.prompt, "keep me");
	const ref = sanitized.input_reference as { image_url: string };
	assert.match(
		ref.image_url,
		/^data:image\/png;base64,\[redacted 5000 chars\]$/,
	);
	const nested = (sanitized.extra_body as { nested: [{ image: string }] })
		.nested[0].image;
	assert.match(nested, /redacted/);
});
