import { toOpenAITranscriptionResponse } from "#contracts/openai/audio.ts";
import type { CanonicalTranscriptionRequest } from "#core/audio.ts";
import { must, jsonBody } from "#test-support/adapters.ts";
import { resolveModelMetadata } from "#catalog/index.ts";
import type { AdapterContext } from "../types.ts";
import { writeFileSync, rmSync } from "node:fs";
import { googleAdapter } from "./index.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AUDIO = Buffer.from([0x49, 0x44, 0x33, 0x04]);

function ctx(): AdapterContext {
	return {
		upstreamModel: "gemini-3.5-transcribe",
		credentials: { apiKey: "AIza-test" },
		meta: resolveModelMetadata("googleaistudio", "gemini-3.5-transcribe"),
		transport: "interactions",
		requestId: "t",
	};
}

function withAudio(overrides: Partial<CanonicalTranscriptionRequest> = {}): {
	req: CanonicalTranscriptionRequest;
	cleanup: () => void;
} {
	const path = join(tmpdir(), `${randomUUID()}.mp3`);
	writeFileSync(path, AUDIO);
	return {
		req: {
			model: "gemini-3.5-transcribe",
			file: {
				path,
				filename: "call.mp3",
				mimeType: "audio/mpeg",
				sizeBytes: AUDIO.byteLength,
			},
			responseFormat: "json",
			stream: false,
			...overrides,
		},
		cleanup: () => rmSync(path, { force: true }),
	};
}

async function bodyFor(
	overrides: Partial<CanonicalTranscriptionRequest>,
): Promise<Record<string, any>> {
	const { req, cleanup } = withAudio(overrides);
	try {
		return jsonBody(
			(await must(googleAdapter, "audioTranscription").buildRequest(
				req,
				ctx(),
			)) as never,
		);
	} finally {
		cleanup();
	}
}

function parse(
	raw: unknown,
	overrides: Partial<CanonicalTranscriptionRequest> = {},
) {
	const { req, cleanup } = withAudio(overrides);
	cleanup();
	return must(googleAdapter, "audioTranscription").parseResponse(
		raw,
		ctx(),
		req,
	);
}

/** An interaction whose single text output carries word annotations. */
function interaction(
	text: string,
	words: [string, string, string, string?][],
): Record<string, unknown> {
	let cursor = 0;
	// Gemini's indices count UTF-8 bytes.
	const bytes = (value: string) => Buffer.byteLength(value, "utf8");
	const annotations = words.map(([word, start, end, speaker]) => {
		const startIndex = text.indexOf(word, cursor);
		cursor = startIndex + word.length;
		return {
			type: "word_info",
			text: word,
			start_offset: start,
			end_offset: end,
			start_index: bytes(text.slice(0, startIndex)),
			end_index: bytes(text.slice(0, cursor)),
			...(speaker ? { speaker } : {}),
		};
	});
	return {
		id: "interactions/abc",
		status: "completed",
		steps: [
			{ type: "user_input", content: [{ type: "audio" }] },
			{
				type: "model_output",
				content: [{ type: "text", text, annotations }],
			},
		],
		usage: {
			total_input_tokens: 750,
			input_tokens_by_modality: [{ modality: "audio", tokens: 750 }],
			total_output_tokens: 12,
			total_tokens: 762,
		},
	};
}

test("google transcription: the adapter serves audio.transcriptions over Interactions", () => {
	assert.ok(googleAdapter.supportedCallTypes.has("audio.transcriptions"));
	assert.deepEqual(googleAdapter.transports?.["audio.transcriptions"], {
		supported: ["interactions"],
		default: "interactions",
	});
});

test("google transcription: plain request sends inline audio and no config", async () => {
	const { req, cleanup } = withAudio();
	try {
		const request = await must(
			googleAdapter,
			"audioTranscription",
		).buildRequest(req, ctx());
		assert.equal(
			request.url,
			"https://generativelanguage.googleapis.com/v1beta/interactions",
		);
		assert.equal(request.headers["x-goog-api-key"], "AIza-test");
		assert.deepEqual(jsonBody(request as never), {
			model: "gemini-3.5-transcribe",
			input: [
				{
					type: "audio",
					data: AUDIO.toString("base64"),
					mime_type: "audio/mpeg",
				},
			],
		});
	} finally {
		cleanup();
	}
});

test("google transcription: keywords and languages map to custom_vocabulary and language_codes", async () => {
	const body = await bodyFor({
		keywords: ["Bifrost", "AC-42"],
		languages: ["es-419", "en-US"],
		prompt: "ignored: Gemini has no prompt",
		temperature: 0.2,
	});
	assert.deepEqual(body.generation_config, {
		transcription_config: {
			language_codes: ["es-419", "en-US"],
			custom_vocabulary: ["Bifrost", "AC-42"],
		},
	});
	assert.equal(
		(await bodyFor({ language: "es-US" })).generation_config
			.transcription_config.language_codes[0],
		"es-US",
	);
});

test("google transcription: modes, diarization and word timestamps follow Google's shapes", async () => {
	assert.deepEqual(
		(await bodyFor({ mode: "smart" })).generation_config.transcription_config,
		{ mode: "smart" },
	);
	assert.equal(
		(await bodyFor({ mode: "verbatim" })).generation_config,
		undefined,
	);
	assert.deepEqual(
		(await bodyFor({ responseFormat: "diarized_json" })).generation_config
			.transcription_config,
		{
			mode: {
				type: "verbatim",
				diarization_mode: "speaker",
				timestamp_granularities: ["word"],
			},
		},
	);
	for (const overrides of [
		{
			responseFormat: "verbose_json" as const,
			timestampGranularities: ["word" as const],
		},
		{ responseFormat: "srt" as const },
		{ responseFormat: "vtt" as const },
	]) {
		assert.deepEqual(
			(await bodyFor(overrides)).generation_config.transcription_config,
			{ mode: { type: "verbatim", timestamp_granularities: ["word"] } },
		);
	}
});

test("google transcription: m4a uploads use Gemini's audio/m4a type", async () => {
	const { req, cleanup } = withAudio();
	try {
		const request = await must(
			googleAdapter,
			"audioTranscription",
		).buildRequest(
			{ ...req, file: { ...req.file, mimeType: "audio/mp4" } },
			ctx(),
		);
		assert.equal(jsonBody(request as never).input[0].mime_type, "audio/m4a");
	} finally {
		cleanup();
	}
});

test("google transcription: extra_body cannot override managed transcription fields", async () => {
	await assert.rejects(
		bodyFor({
			extraBody: {
				generation_config: { transcription_config: { mode: "smart" } },
			},
		}),
		/collides with managed request parameter/,
	);
	assert.deepEqual(
		(
			await bodyFor({
				extraBody: { generation_config: { service_tier: "flex" } },
			})
		).generation_config,
		{ service_tier: "flex" },
	);
});

test("google transcription: json returns the text and token usage", () => {
	const response = parse(interaction("Hola mundo.", []));
	assert.deepEqual(toOpenAITranscriptionResponse(response, "json"), {
		text: "Hola mundo.",
		usage: {
			type: "tokens",
			input_tokens: 750,
			input_token_details: { audio_tokens: 750 },
			output_tokens: 12,
			total_tokens: 762,
		},
	});
});

test("google transcription: verbose_json carries OpenAI word objects", () => {
	const raw = interaction("Hello world.", [
		["Hello", "0.100s", "0.400s"],
		["world.", "0.500s", "0.800s"],
	]);
	const response = parse(raw, {
		responseFormat: "verbose_json",
		timestampGranularities: ["word"],
	});
	assert.deepEqual(toOpenAITranscriptionResponse(response, "verbose_json"), {
		task: "transcribe",
		text: "Hello world.",
		words: [
			{ word: "Hello", start: 0.1, end: 0.4 },
			{ word: "world.", start: 0.5, end: 0.8 },
		],
		usage: {
			type: "tokens",
			input_tokens: 750,
			input_token_details: { audio_tokens: 750 },
			output_tokens: 12,
			total_tokens: 762,
		},
	});
});

test("google transcription: diarized_json groups speaker turns into OpenAI segments", () => {
	const raw = interaction("Hola, Ana. ¡Buenos días! ¿Cómo estás?", [
		["Hola,", "0.0s", "0.3s", "spk:0"],
		["Ana.", "0.3s", "0.7s", "spk:0"],
		["¡Buenos", "1.0s", "1.4s", "spk:1"],
		["días!", "1.5s", "1.7s", "spk:1"],
		["¿Cómo", "1.7s", "1.8s", "spk:1"],
		["estás?", "1.8s", "2.1s", "spk:1"],
	]);
	const rendered = toOpenAITranscriptionResponse(
		parse(raw, { responseFormat: "diarized_json" }),
		"diarized_json",
	) as Record<string, unknown>;
	assert.deepEqual(rendered.segments, [
		{
			type: "transcript.text.segment",
			id: "seg_001",
			start: 0,
			end: 0.7,
			text: "Hola, Ana.",
			speaker: "A",
		},
		{
			type: "transcript.text.segment",
			id: "seg_002",
			start: 1,
			end: 2.1,
			text: "¡Buenos días! ¿Cómo estás?",
			speaker: "B",
		},
	]);
	assert.equal(rendered.task, "transcribe");
	assert.equal(rendered.text, "Hola, Ana. ¡Buenos días! ¿Cómo estás?");
});

test("google transcription: srt and vtt are built from word timestamps", () => {
	const raw = interaction("Good morning. Long pause here", [
		["Good", "0.0s", "0.4s"],
		["morning.", "0.4s", "1.0s"],
		["Long", "1.2s", "1.5s"],
		["pause", "3.0s", "3.4s"],
		["here", "3.4s", "3.9s"],
	]);
	assert.equal(
		toOpenAITranscriptionResponse(parse(raw, { responseFormat: "srt" }), "srt"),
		"1\n00:00:00,000 --> 00:00:01,000\nGood morning.\n\n" +
			"2\n00:00:01,200 --> 00:00:01,500\nLong\n\n" +
			"3\n00:00:03,000 --> 00:00:03,900\npause here\n\n",
	);
	assert.equal(
		toOpenAITranscriptionResponse(parse(raw, { responseFormat: "vtt" }), "vtt"),
		"WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nGood morning.\n\n" +
			"00:00:01.200 --> 00:00:01.500\nLong\n\n" +
			"00:00:03.000 --> 00:00:03.900\npause here\n\n",
	);
});

test("google transcription: a failed interaction is an upstream error, not an empty transcript", () => {
	assert.throws(
		() => parse({ id: "interactions/x", status: "failed", steps: [] }),
		/ended with status failed/,
	);
	assert.throws(() => parse("not json"), /not a JSON object/);
});
