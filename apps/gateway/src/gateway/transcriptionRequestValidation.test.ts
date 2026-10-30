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

const geminiTranscribe = resolveModelMetadata(
	"googleaistudio",
	"gemini-3.5-transcribe",
);

test("gating: Gemini Transcribe accepts each feature on its own", () => {
	for (const overrides of [
		{ keywords: ["Bifrost"] },
		{ responseFormat: "diarized_json" as const },
		{
			responseFormat: "verbose_json" as const,
			timestampGranularities: ["word" as const],
		},
		{ responseFormat: "srt" as const },
		{ responseFormat: "vtt" as const },
		{ mode: "smart" as const },
		{ mode: "verbatim" as const },
		{ languages: ["es-419", "en-US"] },
	]) {
		assert.doesNotThrow(() =>
			assertTranscriptionRequestSupported(req(overrides), geminiTranscribe),
		);
	}
	// Diarization and word timestamps combine; only vocabulary and smart mode exclude them.
	assert.doesNotThrow(() =>
		assertTranscriptionRequestSupported(
			req({ responseFormat: "diarized_json", mode: "verbatim" }),
			geminiTranscribe,
		),
	);
});

test("gating: Gemini Transcribe rejects the combinations Google rejects", () => {
	const cases: [Partial<CanonicalTranscriptionRequest>, string][] = [
		[{ keywords: ["a"], responseFormat: "diarized_json" }, "response_format"],
		[{ keywords: ["a"], responseFormat: "srt" }, "timestamp_granularities"],
		[
			{
				keywords: ["a"],
				responseFormat: "verbose_json",
				timestampGranularities: ["word"],
			},
			"timestamp_granularities",
		],
		[{ mode: "smart", responseFormat: "diarized_json" }, "response_format"],
		[{ mode: "smart", responseFormat: "vtt" }, "timestamp_granularities"],
	];
	for (const [overrides, param] of cases) {
		assert.throws(
			() =>
				assertTranscriptionRequestSupported(req(overrides), geminiTranscribe),
			(error: unknown) =>
				GatewayError.is(error) &&
				error.code === "unsupported_parameter" &&
				error.param === param &&
				/cannot combine/.test(error.message),
		);
	}
});

test("gating: Gemini Transcribe limits granularity, vocabulary size, and streaming", () => {
	assert.throws(
		() =>
			assertTranscriptionRequestSupported(
				req({
					responseFormat: "verbose_json",
					timestampGranularities: ["segment"],
				}),
				geminiTranscribe,
			),
		/timestamp_granularities=segment/,
	);
	assert.throws(
		() =>
			assertTranscriptionRequestSupported(
				req({ keywords: Array.from({ length: 1001 }, (_, i) => `k${i}`) }),
				geminiTranscribe,
			),
		/at most 1000 keywords/,
	);
	assert.doesNotThrow(() =>
		assertTranscriptionRequestSupported(
			req({ keywords: Array.from({ length: 1000 }, (_, i) => `k${i}`) }),
			geminiTranscribe,
		),
	);
	assert.throws(
		() =>
			assertTranscriptionRequestSupported(
				req({ stream: true }),
				geminiTranscribe,
			),
		/streaming/,
	);
});

test("gating: smart mode and diarization are refused by models that do not declare them", () => {
	assert.throws(
		() => assertTranscriptionRequestSupported(req({ mode: "smart" }), gpt4o),
		/transcription_mode=smart/,
	);
	assert.doesNotThrow(() =>
		assertTranscriptionRequestSupported(req({ mode: "verbatim" }), gpt4o),
	);
	assert.throws(
		() =>
			assertTranscriptionRequestSupported(
				req({ responseFormat: "diarized_json" }),
				gpt4o,
			),
		/response_format=diarized_json/,
	);
});

test("gating: dropped keywords never conflict", () => {
	const noKeywords = resolveModelMetadata("openaicompatible", "custom-stt", {
		operations: {
			"audio.transcribe": {
				responseFormats: ["json", "diarized_json"],
				incompatibleFeatures: [["keywords", "diarization"]],
			},
		},
	});
	assert.doesNotThrow(() =>
		assertTranscriptionRequestSupported(
			req({ keywords: ["a"], responseFormat: "diarized_json" }),
			noKeywords,
		),
	);
});
