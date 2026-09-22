import { openaicompatibleAdapter } from "./openaicompatible/index.ts";
import type { CanonicalTranscriptionRequest } from "#core/audio.ts";
import { must, streamOf } from "#test-support/adapters.ts";
import { resolveModelMetadata } from "#catalog/index.ts";
import { openaiAdapter } from "./openai/index.ts";
import type { AdapterContext } from "./types.ts";
import { writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	toOpenAITranscriptionResponse,
	toOpenAITranscriptionEvent,
} from "#contracts/openai/audio.ts";

function ctx(): AdapterContext {
	return {
		upstreamModel: "gpt-4o-transcribe",
		credentials: { apiKey: "k", baseUrl: "https://api.example.com/v1" },
		meta: {
			capabilities: {
				tools: false,
				vision: false,
				reasoning: false,
				structuredOutputs: false,
			},
		},
		transport: "audio_transcriptions",
		requestId: "t",
	};
}

function withAudioFile(): {
	req: CanonicalTranscriptionRequest;
	cleanup: () => void;
} {
	const path = join(tmpdir(), `${randomUUID()}.mp3`);
	writeFileSync(path, Buffer.from([0x49, 0x44, 0x33])); // "ID3"
	const req: CanonicalTranscriptionRequest = {
		model: "gpt-4o-transcribe",
		file: {
			path,
			filename: "speech.mp3",
			mimeType: "audio/mpeg",
			sizeBytes: 3,
		},
		responseFormat: "json",
		stream: false,
	};
	return { req, cleanup: () => rmSync(path, { force: true }) };
}

test("audio: both OpenAI adapters expose the handler", () => {
	assert.ok(openaiAdapter.supportedCallTypes.has("audio.transcriptions"));
	assert.ok(
		openaicompatibleAdapter.supportedCallTypes.has("audio.transcriptions"),
	);
	assert.ok(openaicompatibleAdapter.audioTranscription);
});

test("audio.buildRequest: multipart to /audio/transcriptions with file/model/response_format", async () => {
	const { req, cleanup } = withAudioFile();
	try {
		const r = await must(
			openaicompatibleAdapter,
			"audioTranscription",
		).buildRequest(
			{
				...req,
				language: "es",
				timestampGranularities: ["segment"],
				responseFormat: "verbose_json",
			},
			ctx(),
		);
		assert.equal(r.method, "POST");
		assert.equal(r.url, "https://api.example.com/v1/audio/transcriptions");
		assert.equal(r.headers.authorization, "Bearer k");
		assert.equal(r.headers["content-type"], undefined); // FormData sets the boundary
		const form = r.body as FormData;
		assert.equal(form.get("model"), "gpt-4o-transcribe");
		assert.equal(form.get("response_format"), "verbose_json");
		assert.equal(form.get("language"), "es");
		assert.equal(form.get("timestamp_granularities[]"), "segment");
		const file = form.get("file") as File;
		assert.equal(file.name, "speech.mp3");
		assert.equal(file.type, "audio/mpeg");
	} finally {
		cleanup();
	}
});

test("audio.buildRequest: extra_body cannot overwrite managed fields", async () => {
	const { req, cleanup } = withAudioFile();
	try {
		await assert.rejects(async () => {
			await must(openaicompatibleAdapter, "audioTranscription").buildRequest(
				{ ...req, extraBody: { model: "x" } },
				ctx(),
			);
		}, /extra_body\.model/);
	} finally {
		cleanup();
	}
});

test("audio: hints follow candidate capabilities without mutating the request", async () => {
	const { req, cleanup } = withAudioFile();
	req.model = "public-alias";
	req.keywords = ["Bifrost", "AC-42"];
	req.languages = ["es", "en"];
	try {
		for (const model of [
			"gpt-transcribe",
			"gpt-4o-transcribe",
			"gpt-transcribe",
		]) {
			const context = {
				...ctx(),
				upstreamModel: model,
				meta: resolveModelMetadata("openai", model),
			};
			const r = await must(openaiAdapter, "audioTranscription").buildRequest(
				req,
				context,
			);
			const form = r.body as FormData;
			const supported = model === "gpt-transcribe";
			assert.deepEqual(
				form.getAll("keywords[]"),
				supported ? req.keywords : [],
			);
			assert.deepEqual(
				form.getAll("languages[]"),
				supported ? req.languages : [],
			);
			assert.equal(form.has("language"), false);
			assert.equal(form.has("prompt"), false);
		}
		assert.deepEqual(req.keywords, ["Bifrost", "AC-42"]);
		assert.deepEqual(req.languages, ["es", "en"]);
		const context = {
			...ctx(),
			meta: resolveModelMetadata("openaicompatible", "custom", {
				operations: {
					"audio.transcribe": {
						responseFormats: ["json"],
						supportsKeywords: true,
						supportsLanguageHints: true,
					},
				},
			}),
		};
		const r = await must(
			openaicompatibleAdapter,
			"audioTranscription",
		).buildRequest(req, context);
		assert.deepEqual((r.body as FormData).getAll("keywords[]"), req.keywords);
	} finally {
		cleanup();
	}
});

test("audio: extra_body cannot inject hints, with or without brackets", async () => {
	const { req, cleanup } = withAudioFile();
	try {
		for (const key of ["keywords", "keywords[]", "languages", "languages[]"]) {
			await assert.rejects(
				async () =>
					await must(openaiAdapter, "audioTranscription").buildRequest(
						{ ...req, extraBody: { [key]: ["x"] } },
						ctx(),
					),
				/collides with a managed transcription field/,
			);
		}
	} finally {
		cleanup();
	}
});

test("audio: detected languages survive JSON and final SSE responses, including empty detection", async () => {
	const handler = must(openaiAdapter, "audioTranscription");
	for (const languages of [[{ code: "es" }, { code: "en" }], []]) {
		const body = { text: "Hola", languages };
		assert.deepEqual(
			toOpenAITranscriptionResponse(handler.parseResponse(body, ctx()), "json"),
			body,
		);
		const event = { type: "transcript.text.done", ...body };
		const stream = streamOf(`data: ${JSON.stringify(event)}\n\n`);
		const rendered: Record<string, unknown>[] = [];
		for await (const item of handler.parseStream!(stream, ctx())) {
			rendered.push(toOpenAITranscriptionEvent(item));
		}
		assert.deepEqual(rendered, [event]);
	}
});

test("audio.parseResponse: plain text -> {text}; json -> text+usage; verbose_json -> segments", () => {
	const cap = must(openaicompatibleAdapter, "audioTranscription");
	assert.deepEqual(cap.parseResponse("hello world", ctx()), {
		text: "hello world",
	});

	const json = cap.parseResponse(
		{
			text: "hi",
			usage: {
				type: "tokens",
				input_tokens: 5,
				output_tokens: 3,
				total_tokens: 8,
			},
		},
		ctx(),
	);
	assert.equal(json.text, "hi");
	assert.equal(json.usage?.type, "tokens");
	assert.equal(json.usage?.totalTokens, 8);

	const verbose = cap.parseResponse(
		{
			text: "hi",
			language: "english",
			duration: 1.2,
			segments: [{ id: 0, text: "hi" }],
		},
		ctx(),
	);
	assert.equal(verbose.language, "english");
	assert.equal(verbose.duration, 1.2);
	assert.equal(verbose.segments?.length, 1);
});

test("audio.parseStream: transcript.text.delta/done -> canonical events with usage", async () => {
	const sse =
		`data: {"type":"transcript.text.delta","delta":"Hel"}\n\n` +
		`data: {"type":"transcript.text.delta","delta":"lo"}\n\n` +
		`data: {"type":"transcript.text.done","text":"Hello","usage":{"type":"tokens","input_tokens":4,"output_tokens":2,"total_tokens":6}}\n\n`;
	const deltas: string[] = [];
	let doneText: string | undefined;
	let total: number | undefined;
	for await (const event of must(openaicompatibleAdapter, "audioTranscription")
		.parseStream!(streamOf(sse), ctx())) {
		if (event.kind === "delta") {
			deltas.push(event.delta);
		} else {
			doneText = event.text;
			total = event.usage?.totalTokens;
		}
	}
	assert.equal(deltas.join(""), "Hello");
	assert.equal(doneText, "Hello");
	assert.equal(total, 6);
});
