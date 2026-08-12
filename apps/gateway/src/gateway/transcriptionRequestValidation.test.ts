import { assertTranscriptionRequestSupported } from "./transcriptionRequestValidation.ts";
import type { CanonicalTranscriptionRequest } from "#core/audio.ts";
import { resolveModelMetadata } from "#catalog/index.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const file = {
	path: "/tmp/a.mp3",
	filename: "a.mp3",
	mimeType: "audio/mpeg",
	sizeBytes: 100,
};
function req(
	overrides: Partial<CanonicalTranscriptionRequest> = {},
): CanonicalTranscriptionRequest {
	return {
		model: "m",
		file,
		responseFormat: "json",
		stream: false,
		...overrides,
	};
}

const gpt4o = resolveModelMetadata("openai", "gpt-4o-transcribe");
// Flexible custom model: all formats + timestamps, no streaming.
const flexible = resolveModelMetadata("openaicompatible", "custom-stt", {
	operations: {
		"audio.transcribe": {
			responseFormats: ["json", "text", "srt", "verbose_json", "vtt"],
			supportsTimestampGranularities: true,
		},
	},
});

test("catalog: gpt-4o-transcribe resolves the audio operation", () => {
	assert.ok(gpt4o.supportedCallTypes?.includes("audio.transcriptions"));
});

test("gating: flexible model accepts verbose_json + timestamps and rejects streaming", () => {
	assert.doesNotThrow(() =>
		assertTranscriptionRequestSupported(
			req({
				responseFormat: "verbose_json",
				timestampGranularities: ["segment"],
			}),
			flexible,
		),
	);
	assert.throws(
		() => assertTranscriptionRequestSupported(req({ stream: true }), flexible),
		/streaming/,
	);
});

test("gating: gpt-4o-transcribe allows streaming but not verbose_json", () => {
	assert.doesNotThrow(() =>
		assertTranscriptionRequestSupported(req({ stream: true }), gpt4o),
	);
	assert.throws(
		() =>
			assertTranscriptionRequestSupported(
				req({ responseFormat: "verbose_json" }),
				gpt4o,
			),
		/response_format/,
	);
});

test("gating: timestamp_granularities requires verbose_json", () => {
	assert.throws(
		() =>
			assertTranscriptionRequestSupported(
				req({ timestampGranularities: ["word"] }),
				flexible,
			),
		/verbose_json/,
	);
});

test("gating: file above the model limit is rejected", () => {
	const big = req({ file: { ...file, sizeBytes: 30_000_000 } });
	const err = (() => {
		try {
			assertTranscriptionRequestSupported(big, gpt4o);
		} catch (e) {
			return e;
		}
	})();
	assert.ok(GatewayError.is(err));
	assert.equal((err as GatewayError).param, "file");
});
