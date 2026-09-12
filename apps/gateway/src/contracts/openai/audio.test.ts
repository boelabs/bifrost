import assert from "node:assert/strict";
import { test } from "node:test";

import {
	toOpenAITranscriptionResponse,
	toOpenAITranscriptionEvent,
	transcriptionFieldsSchema,
	transcriptionToCanonical,
} from "./audio.ts";

import type {
	CanonicalTranscriptionResponse,
	CanonicalAudioInput,
} from "#core/audio.ts";

const file: CanonicalAudioInput = {
	path: "/tmp/x.mp3",
	filename: "x.mp3",
	mimeType: "audio/mpeg",
	sizeBytes: 10,
};

test("schema: response_format defaults to json; rejects unknown fields", () => {
	const ok = transcriptionFieldsSchema.parse({ model: "gpt-4o-transcribe" });
	assert.equal(ok.response_format, "json");
	assert.equal(
		transcriptionFieldsSchema.safeParse({ model: "m", bogus: 1 }).success,
		false,
	);
});

test("toCanonical: maps fields and normalizes stream/extra_body", () => {
	const fields = transcriptionFieldsSchema.parse({
		model: "gpt-4o-transcribe",
		language: "es",
		temperature: 0.2,
		response_format: "verbose_json",
		timestamp_granularities: ["segment", "word"],
		extra_body: { chunking_strategy: "auto" },
	});
	const req = transcriptionToCanonical(fields, file);
	assert.equal(req.model, "gpt-4o-transcribe");
	assert.equal(req.responseFormat, "verbose_json");
	assert.equal(req.stream, false);
	assert.deepEqual(req.timestampGranularities, ["segment", "word"]);
	assert.deepEqual(req.extraBody, { chunking_strategy: "auto" });
	assert.equal(req.file.filename, "x.mp3");
});

test("render: json -> {text,usage}; verbose_json -> task/segments; text -> raw string", () => {
	const resp: CanonicalTranscriptionResponse = {
		text: "hello",
		language: "spanish",
		duration: 2,
		segments: [{ id: 0 }],
		usage: { type: "tokens", inputTokens: 5, outputTokens: 3, totalTokens: 8 },
	};
	const json = toOpenAITranscriptionResponse(resp, "json") as Record<
		string,
		unknown
	>;
	assert.equal(json.text, "hello");
	assert.deepEqual(json.usage, {
		type: "tokens",
		input_tokens: 5,
		output_tokens: 3,
		total_tokens: 8,
	});

	const verbose = toOpenAITranscriptionResponse(resp, "verbose_json") as Record<
		string,
		unknown
	>;
	assert.equal(verbose.task, "transcribe");
	assert.equal(verbose.language, "spanish");
	assert.equal(verbose.duration, 2);
	assert.deepEqual(verbose.segments, [{ id: 0 }]);

	assert.equal(toOpenAITranscriptionResponse(resp, "srt"), "hello");
	assert.equal(toOpenAITranscriptionResponse(resp, "text"), "hello");
});

test("render: stream events", () => {
	assert.deepEqual(toOpenAITranscriptionEvent({ kind: "delta", delta: "Hi" }), {
		type: "transcript.text.delta",
		delta: "Hi",
	});
	assert.deepEqual(
		toOpenAITranscriptionEvent({
			kind: "done",
			text: "Hi",
			usage: { type: "tokens", totalTokens: 6 },
		}),
		{
			type: "transcript.text.done",
			text: "Hi",
			usage: { type: "tokens", total_tokens: 6 },
		},
	);
});
