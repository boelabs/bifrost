import assert from "node:assert/strict";
import type { FetchLike } from "./api";
import { test } from "node:test";

import {
	transcriptionForm,
	transcriptionFrom,
	runTranscription,
	timestamp,
} from "./transcription";

const file = new File([new Uint8Array([1, 2, 3])], "interview.wav", {
	type: "audio/wav",
});

test("the form carries the file and only the settings that were chosen", () => {
	const bare = transcriptionForm("whisper", file, {});
	assert.equal(bare.get("model"), "whisper");
	assert.ok(bare.get("file") instanceof File);
	assert.equal(bare.get("response_format"), null);
	assert.equal(bare.get("language"), null);

	const full = transcriptionForm("whisper", file, {
		responseFormat: "verbose_json",
		language: "es",
		prompt: "Bifrost, Boelabs",
		temperature: 0.2,
		timestampGranularities: ["segment", "word"],
	});
	assert.equal(full.get("response_format"), "verbose_json");
	assert.equal(full.get("language"), "es");
	assert.equal(full.get("prompt"), "Bifrost, Boelabs");
	assert.equal(full.get("temperature"), "0.2");
	assert.deepEqual(full.getAll("timestamp_granularities[]"), [
		"segment",
		"word",
	]);
});

test("timestamps are asked for only where they exist", () => {
	const form = transcriptionForm("whisper", file, {
		responseFormat: "json",
		timestampGranularities: ["segment"],
	});
	assert.deepEqual(form.getAll("timestamp_granularities[]"), []);
});

test("a subtitle or plain-text answer is kept exactly as it arrived", () => {
	const srt = "1\n00:00:00,000 --> 00:00:02,000\nHola\n";
	assert.deepEqual(transcriptionFrom(srt, "text/plain"), {
		text: srt,
		segments: [],
	});
});

test("a verbose answer carries its segments, language and duration", () => {
	assert.deepEqual(
		transcriptionFrom(
			JSON.stringify({
				text: "Hola que tal",
				language: "spanish",
				duration: 4.2,
				segments: [
					{ id: 0, start: 0, end: 2, text: "Hola" },
					{ id: 1, start: 2, end: 4, text: "que tal" },
					{ id: 2 },
				],
			}),
			"application/json; charset=utf-8",
		),
		{
			text: "Hola que tal",
			language: "spanish",
			duration: 4.2,
			segments: [
				{ text: "Hola", start: 0, end: 2 },
				{ text: "que tal", start: 2, end: 4 },
			],
		},
	);
});

test("a JSON answer without a text field is rebuilt from its segments", () => {
	assert.equal(
		transcriptionFrom(
			JSON.stringify({ segments: [{ text: "one" }, { text: "two" }] }),
			"application/json",
		).text,
		"one two",
	);
});

test("timestamps read as minutes and seconds", () => {
	assert.equal(timestamp(0), "0:00.0");
	assert.equal(timestamp(9.25), "0:09.3");
	assert.equal(timestamp(125), "2:05.0");
});

test("the request is multipart to the relay, and failures keep the gateway's message", async () => {
	let url: string | undefined;
	let multipart = false;
	const ok: FetchLike = async (input, init) => {
		url = String(input);
		multipart = init?.body instanceof FormData;
		return new Response(JSON.stringify({ text: "hola" }), {
			headers: { "content-type": "application/json" },
		});
	};
	const result = await runTranscription(
		{ model: "whisper", file, settings: {} },
		{ fetch: ok, csrf: () => undefined },
	);
	assert.equal(url, "/api/v1/audio/transcriptions");
	assert.equal(multipart, true);
	assert.equal(result.text, "hola");

	const failing: FetchLike = async () =>
		new Response(JSON.stringify({ error: { message: "file is too large" } }), {
			status: 413,
			headers: { "content-type": "application/json" },
		});
	await assert.rejects(
		runTranscription(
			{ model: "whisper", file, settings: {} },
			{ fetch: failing, csrf: () => undefined },
		),
		/file is too large/,
	);
});
