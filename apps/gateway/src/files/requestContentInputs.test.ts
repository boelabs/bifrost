import { openaicompatibleAdapter } from "#adapters/openaicompatible/index.ts";
import type { DeploymentCandidate } from "#gateway/deploymentCandidates.ts";
import { deepseekAdapter } from "#adapters/deepseek/index.ts";
import { googleAdapter } from "#adapters/google/index.ts";
import { openaiAdapter } from "#adapters/openai/index.ts";
import type { Adapter } from "#adapters/types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createContentInputResolver,
	createVideoInputResolver,
} from "./requestContentInputs.ts";

import type {
	CanonicalContentPart,
	CanonicalChatRequest,
} from "#core/canonical.ts";

const PDF_BASE64 =
	"JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNTcgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA3MiA3MjAgVGQgKFBvcnRhYmxlIGF0dGFjaG1lbnQgdGV4dCkgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQxNgolJUVPRgo=";
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function candidate(adapter: Adapter, vision = true): DeploymentCandidate {
	return {
		row: {} as DeploymentCandidate["row"],
		adapter,
		upstreamModel: "upstream-model",
		meta: {
			capabilities: {
				tools: true,
				vision,
				reasoning: false,
				structuredOutputs: true,
			},
		},
	};
}

function request(
	file: CanonicalContentPart,
	fileParser?: CanonicalChatRequest["fileParser"],
): CanonicalChatRequest {
	return {
		callType: "chat",
		publicWire: "responses",
		model: "public-model",
		messages: [{ role: "user", content: [file] }],
		stream: false,
		...(fileParser !== undefined ? { fileParser } : {}),
	};
}

test("file resolver materializes a PDF URL once for Gemini inlineData", async () => {
	let fetches = 0;
	let pinnedAddresses: readonly { address: string; family: number }[] = [];
	const resolver = createContentInputResolver(
		request({
			type: "file",
			fileUrl: "https://assets.example/document.pdf",
			filename: "document.pdf",
		}),
		new AbortController().signal,
		{
			resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
			fetch: async (_url, _options, addresses) => {
				fetches += 1;
				pinnedAddresses = addresses;
				return new Response(new Uint8Array(Buffer.from(PDF_BASE64, "base64")), {
					headers: { "content-type": "application/pdf" },
				});
			},
		},
	);
	const google = candidate(googleAdapter);
	resolver.assertCandidate(google, "generate_content");

	const first = await resolver.resolveForCandidate(google, "generate_content");
	const second = await resolver.resolveForCandidate(google, "generate_content");
	assert.equal(fetches, 1);
	assert.deepEqual(pinnedAddresses, [{ address: "93.184.216.34", family: 4 }]);
	assert.deepEqual(first.metadata, {
		pdfEngine: "auto",
		materializedFiles: 1,
		materializedImages: 0,
		nativeFiles: 1,
		nativeImages: 0,
		parsedFiles: 0,
	});
	assert.equal(second.metadata?.materializedFiles, 1);

	const built = googleAdapter.chat!.buildRequest(first.request, {
		upstreamModel: "upstream-model",
		credentials: { apiKey: "test-key" },
		meta: google.meta,
		transport: "generate_content",
		requestId: "test-request",
	});
	const body = JSON.parse(built.body!);
	assert.equal(
		body.contents[0].parts[0].inlineData.mimeType,
		"application/pdf",
	);
	assert.equal(body.contents[0].parts[0].inlineData.data, PDF_BASE64);
});

test("content resolver materializes Responses image URLs for Gemini and memoizes history", async () => {
	let fetches = 0;
	let activeFetches = 0;
	let peakFetches = 0;
	const imageUrls = Array.from(
		{ length: 6 },
		(_, index) => `https://assets.example/history-${index}.png`,
	);
	const canonical: CanonicalChatRequest = {
		callType: "chat",
		publicWire: "responses",
		model: "public-model",
		messages: [
			{
				role: "user",
				content: [
					{
						type: "file",
						fileData: "data:text/plain;base64,aGVsbG8=",
						filename: "chapter.txt",
					},
					...imageUrls.map((url) => ({ type: "image" as const, url })),
				],
			},
		],
		stream: true,
	};
	const resolver = createContentInputResolver(
		canonical,
		new AbortController().signal,
		{
			resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
			fetch: (async () => {
				fetches += 1;
				activeFetches += 1;
				peakFetches = Math.max(peakFetches, activeFetches);
				await new Promise((resolve) => setTimeout(resolve, 2));
				activeFetches -= 1;
				return new Response(new Uint8Array(Buffer.from(PNG_BASE64, "base64")), {
					headers: { "content-type": "image/png" },
				});
			}) as typeof fetch,
		},
	);
	const google = candidate(googleAdapter);
	resolver.assertCandidate(google, "generate_content");

	const first = await resolver.resolveForCandidate(google, "generate_content");
	const second = await resolver.resolveForCandidate(google, "generate_content");
	assert.equal(fetches, 6);
	assert.equal(peakFetches, 4);
	assert.deepEqual(first.metadata, {
		pdfEngine: "auto",
		materializedFiles: 0,
		materializedImages: 6,
		nativeFiles: 1,
		nativeImages: 6,
		parsedFiles: 0,
	});
	assert.equal(second.metadata?.materializedImages, 6);

	const built = googleAdapter.chat!.buildRequest(first.request, {
		upstreamModel: "gemini-2.5-flash",
		credentials: { apiKey: "test-key" },
		meta: google.meta,
		transport: "generate_content",
		requestId: "test-request",
	});
	const parts = JSON.parse(built.body!).contents[0].parts;
	assert.equal(parts.length, 7);
	assert.equal(parts[0].inlineData.mimeType, "text/plain");
	for (const part of parts.slice(1)) {
		assert.equal(part.inlineData.mimeType, "image/png");
		assert.equal(part.inlineData.data, PNG_BASE64);
	}
});

test("content resolver preserves native image URLs without downloading them", async () => {
	let fetches = 0;
	const resolver = createContentInputResolver(
		request({
			type: "image",
			url: "https://assets.example/native.png",
		}),
		new AbortController().signal,
		{
			fetch: (async () => {
				fetches += 1;
				throw new Error("unexpected fetch");
			}) as typeof fetch,
		},
	);
	const resolved = await resolver.resolveForCandidate(
		candidate(openaiAdapter),
		"responses",
	);
	assert.equal(fetches, 0);
	assert.equal(resolved.metadata?.nativeImages, 1);
	assert.equal(resolved.metadata?.materializedImages, 0);
	assert.deepEqual(resolved.request.messages[0]?.content, [
		{ type: "image", url: "https://assets.example/native.png" },
	]);
});

test("materialized image inputs reject content with a non-image signature", async () => {
	const resolver = createContentInputResolver(
		request({
			type: "image",
			url: "https://assets.example/not-really-an-image.png",
		}),
		new AbortController().signal,
		{
			resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
			fetch: (async () =>
				new Response("<html>not an image</html>", {
					headers: { "content-type": "text/html" },
				})) as typeof fetch,
		},
	);
	await assert.rejects(
		() =>
			resolver.resolveForCandidate(
				candidate(googleAdapter),
				"generate_content",
			),
		(error: unknown) =>
			(error as { code?: string; routingScope?: string }).code ===
				"image_type_mismatch" &&
			(error as { routingScope?: string }).routingScope === "request",
	);
});

test("file resolver converts UTF-8 JSON to a portable text part", async () => {
	const data = Buffer.from('{"answer":42}', "utf8").toString("base64");
	const resolved = await createContentInputResolver(
		request({
			type: "file",
			fileData: `data:application/json;base64,${data}`,
			filename: "answer.json",
		}),
		new AbortController().signal,
	).resolveForCandidate(candidate(deepseekAdapter), "chat_completions");

	assert.equal(resolved.metadata?.parsedFiles, 1);
	const content = resolved.request.messages[0]?.content;
	assert.ok(Array.isArray(content));
	assert.equal(content[0]?.type, "text");
	assert.match((content[0] as { text: string }).text, /\{"answer":42\}/);
});

test("pdf-text extracts a text PDF for a text-only upstream", async () => {
	const resolved = await createContentInputResolver(
		request(
			{
				type: "file",
				fileData: `data:application/pdf;base64,${PDF_BASE64}`,
				filename: "portable.pdf",
			},
			{ pdfEngine: "pdf-text" },
		),
		new AbortController().signal,
	).resolveForCandidate(candidate(deepseekAdapter), "chat_completions");

	const content = resolved.request.messages[0]?.content;
	assert.ok(Array.isArray(content));
	assert.match(
		(content[0] as { text: string }).text,
		/Portable attachment text/,
	);
});

test("auto parses a PDF when the native transport model is not vision-capable", async () => {
	const resolved = await createContentInputResolver(
		request({
			type: "file",
			fileData: `data:application/pdf;base64,${PDF_BASE64}`,
		}),
		new AbortController().signal,
	).resolveForCandidate(candidate(openaiAdapter, false), "responses");
	assert.equal(resolved.metadata?.nativeFiles, 0);
	assert.equal(resolved.metadata?.parsedFiles, 1);
});

test("native engine rejects a text-only upstream during eligibility", () => {
	const resolver = createContentInputResolver(
		request(
			{
				type: "file",
				fileData: "data:text/plain;base64,aGVsbG8=",
			},
			{ pdfEngine: "native" },
		),
		new AbortController().signal,
	);
	assert.throws(
		() =>
			resolver.assertCandidate(candidate(deepseekAdapter), "chat_completions"),
		(error: unknown) =>
			(error as { code?: string }).code === "native_file_input_unsupported",
	);
});

test("remote file materialization rejects private network targets", () => {
	assert.throws(
		() =>
			createContentInputResolver(
				request({
					type: "file",
					fileUrl: "https://127.0.0.1/document.pdf",
				}),
				new AbortController().signal,
			),
		(error: unknown) => (error as { code?: string }).code === "unsafe_file_url",
	);
});

test("remote image materialization rejects private network targets", () => {
	assert.throws(
		() =>
			createContentInputResolver(
				request({
					type: "image",
					url: "https://127.0.0.1/image.png",
				}),
				new AbortController().signal,
			),
		(error: unknown) =>
			(error as { code?: string }).code === "unsafe_image_url",
	);
});

test("remote inputs reject IPv6 transition ranges that can reach blocked networks", () => {
	for (const address of [
		"64:ff9b::7f00:1",
		"2001:0000:4136:e378:8000:63bf:3fff:fdd2",
		"2002:7f00:1::",
	]) {
		assert.throws(
			() =>
				createContentInputResolver(
					request({
						type: "file",
						fileUrl: `https://[${address}]/document.pdf`,
					}),
					new AbortController().signal,
				),
			(error: unknown) =>
				(error as { code?: string }).code === "unsafe_file_url",
		);
	}
});

test("remote inputs accept conventional public IPv6 literals", () => {
	assert.doesNotThrow(() =>
		createContentInputResolver(
			request({
				type: "file",
				fileUrl: "https://[2606:4700:4700::1111]/document.pdf",
			}),
			new AbortController().signal,
		),
	);
});

test("only opaque content sources require an additional token reservation", () => {
	const inline = createContentInputResolver(
		request({
			type: "file",
			fileData: "data:text/plain;base64,aGVsbG8=",
		}),
		new AbortController().signal,
	);
	const remote = createContentInputResolver(
		request({
			type: "file",
			fileUrl: "https://example.com/document.pdf",
		}),
		new AbortController().signal,
	);
	assert.equal(inline.hasOpaqueInputs, false);
	assert.equal(remote.hasOpaqueInputs, true);
});

test("video resolver downloads every remote media reference before adapter execution", async () => {
	const fetches: string[] = [];
	const resolver = createVideoInputResolver(
		{
			model: "video-model",
			prompt: "Animate the references",
			inputReferences: [
				{ type: "image_url", url: "https://assets.example/input.png" },
				{ type: "audio_url", url: "https://assets.example/input.wav" },
				{ type: "video_url", url: "https://assets.example/input.mp4" },
			],
			frameImages: [{ frame: "last", url: "https://assets.example/input.png" }],
		},
		new AbortController().signal,
		{
			resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
			fetch: async (url) => {
				fetches.push(url.href);
				if (url.pathname.endsWith(".png")) {
					return new Response(
						new Uint8Array(Buffer.from(PNG_BASE64, "base64")),
						{ headers: { "content-type": "image/png" } },
					);
				}
				if (url.pathname.endsWith(".wav")) {
					return new Response(new Uint8Array([1, 2, 3]), {
						headers: { "content-type": "audio/wav" },
					});
				}
				return new Response(new Uint8Array([4, 5, 6]), {
					headers: { "content-type": "video/mp4" },
				});
			},
		},
	);
	const upstream = candidate(openaicompatibleAdapter);
	resolver.assertCandidate(upstream, "videos_async");

	const resolved = await resolver.resolveForCandidate(upstream, "videos_async");
	assert.equal(fetches.length, 3);
	assert.ok(
		resolved.request.inputReferences?.every(
			(ref) => ref.type === "file_id" || ref.url.startsWith("data:"),
		),
	);
	assert.match(
		resolved.request.frameImages?.[0]?.url ?? "",
		/^data:image\/png/,
	);
	assert.deepEqual(resolved.metadata, {
		materializedAudio: 1,
		materializedImages: 2,
		materializedVideo: 1,
		totalBytes: Buffer.from(PNG_BASE64, "base64").byteLength * 2 + 6,
	});
});

test("video resolver rejects private remote media URLs before routing", () => {
	assert.throws(
		() =>
			createVideoInputResolver(
				{
					model: "video-model",
					prompt: "Animate",
					inputReferences: [
						{ type: "video_url", url: "https://127.0.0.1/input.mp4" },
					],
				},
				new AbortController().signal,
			),
		(error: unknown) =>
			(error as { code?: string }).code === "unsafe_video_url",
	);
});

test("video resolver rejects media whose MIME does not match its reference type", async () => {
	const resolver = createVideoInputResolver(
		{
			model: "video-model",
			prompt: "Animate",
			inputReferences: [
				{ type: "audio_url", url: "https://assets.example/not-audio.bin" },
			],
		},
		new AbortController().signal,
		{
			resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
			fetch: async () =>
				new Response(new Uint8Array(Buffer.from(PNG_BASE64, "base64")), {
					headers: { "content-type": "image/png" },
				}),
		},
	);
	await assert.rejects(
		() =>
			resolver.resolveForCandidate(
				candidate(openaicompatibleAdapter),
				"videos_async",
			),
		(error: unknown) =>
			(error as { code?: string }).code === "unsupported_audio_input",
	);
});

test("video resolver enforces the 50 MB decoded-media limit before reading a body", async () => {
	const resolver = createVideoInputResolver(
		{
			model: "video-model",
			prompt: "Animate",
			inputReferences: [
				{ type: "video_url", url: "https://assets.example/oversized.mp4" },
			],
		},
		new AbortController().signal,
		{
			resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
			fetch: async () =>
				new Response(new Uint8Array([1]), {
					headers: {
						"content-length": "50000001",
						"content-type": "video/mp4",
					},
				}),
		},
	);
	await assert.rejects(
		() =>
			resolver.resolveForCandidate(
				candidate(openaicompatibleAdapter),
				"videos_async",
			),
		(error: unknown) => (error as { code?: string }).code === "video_too_large",
	);
});
