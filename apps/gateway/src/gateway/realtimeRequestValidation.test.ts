import { assertRealtimeConfigSupported } from "./realtimeRequestValidation.ts";
import type { CanonicalRealtimeTranscriptionConfig } from "#core/realtime.ts";
import { resolveModelMetadata } from "#catalog/index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const live = resolveModelMetadata(
	"googleaistudio",
	"gemini-3.5-transcribe-live",
);

function config(
	overrides: Partial<CanonicalRealtimeTranscriptionConfig> = {},
): CanonicalRealtimeTranscriptionConfig {
	return { model: "m", turnDetection: "server_vad", ...overrides };
}

test("realtime gating: Gemini Transcribe Live accepts its documented options", () => {
	for (const overrides of [
		{},
		{ turnDetection: "manual" as const },
		{ mode: "smart" as const },
		{ languages: ["es-419", "en-US"] },
		{ keywords: Array.from({ length: 1000 }, (_, i) => `k${i}`) },
	]) {
		assert.doesNotThrow(() =>
			assertRealtimeConfigSupported(config(overrides), live),
		);
	}
});

test("realtime gating: too many keywords, unknown modes and file-only models are refused", () => {
	assert.throws(
		() =>
			assertRealtimeConfigSupported(
				config({ keywords: Array.from({ length: 1001 }, (_, i) => `k${i}`) }),
				live,
			),
		/at most 1000 keywords/,
	);
	const fileOnly = resolveModelMetadata(
		"googleaistudio",
		"gemini-3.5-transcribe",
	);
	assert.throws(
		() => assertRealtimeConfigSupported(config(), fileOnly),
		/does not support realtime transcription/,
	);
	const verbatimManualOnly = resolveModelMetadata(
		"openaicompatible",
		"custom-live",
		{
			operations: {
				"audio.transcribe.realtime": { turnDetection: ["manual"] },
			},
		},
	);
	assert.throws(
		() =>
			assertRealtimeConfigSupported(
				config({ mode: "smart" }),
				verbatimManualOnly,
			),
		/transcription_mode=smart/,
	);
	assert.throws(
		() => assertRealtimeConfigSupported(config(), verbatimManualOnly),
		/turn_detection to be null/,
	);
});
