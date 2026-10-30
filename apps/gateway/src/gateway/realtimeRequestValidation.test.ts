import type {
	CanonicalRealtimeConversationConfig,
	CanonicalRealtimeTranscriptionConfig,
} from "#core/realtime.ts";
import { GatewayError } from "#core/errors.ts";

import {
	assertRealtimeConversationSupported,
	assertRealtimeConfigSupported,
} from "./realtimeRequestValidation.ts";
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

function conversation(
	overrides: Partial<CanonicalRealtimeConversationConfig> = {},
): CanonicalRealtimeConversationConfig {
	return {
		model: "live",
		outputModality: "audio",
		vad: { type: "server_vad", interruptResponse: true, createResponse: true },
		inputTranscription: null,
		tools: [],
		toolChoice: "auto",
		googleSearch: false,
		truncation: "auto",
		...overrides,
	};
}

test("realtime conversation: the model profile gates voices, reasoning, tools and translation", () => {
	const conversationModel = resolveModelMetadata(
		"googleaistudio",
		"gemini-3.8-live",
	);
	const thinking = resolveModelMetadata(
		"googleaistudio",
		"gemini-3.8-live-extended-thinking",
	);
	const translate = resolveModelMetadata(
		"googleaistudio",
		"gemini-3.5-live-translate-preview",
	);
	const refuses = (
		candidate: CanonicalRealtimeConversationConfig,
		meta: ReturnType<typeof resolveModelMetadata>,
		param: string,
	) =>
		assert.throws(
			() => assertRealtimeConversationSupported(candidate, meta),
			(error: unknown) =>
				error instanceof GatewayError && error.param === param,
		);
	assertRealtimeConversationSupported(
		conversation({
			voice: "Kore",
			instructions: "Hi",
			tools: [{ name: "f" }],
			googleSearch: true,
			inputTranscription: { keywords: ["Bifrost"] },
			vad: null,
		}),
		conversationModel,
	);
	refuses(
		conversation({ voice: "alloy" }),
		conversationModel,
		"session.audio.output.voice",
	);
	refuses(
		conversation({ speed: 1.2 }),
		conversationModel,
		"session.audio.output.speed",
	);
	refuses(
		conversation({ reasoningEffort: "low" }),
		conversationModel,
		"session.reasoning.effort",
	);
	assertRealtimeConversationSupported(
		conversation({ reasoningEffort: "high" }),
		thinking,
	);
	refuses(
		conversation({ reasoningEffort: "minimal" }),
		thinking,
		"session.reasoning.effort",
	);
	refuses(
		conversation({
			vad: {
				type: "server_vad",
				interruptResponse: true,
				createResponse: false,
			},
		}),
		conversationModel,
		"session.audio.input.turn_detection.create_response",
	);
	refuses(
		conversation({
			vad: {
				type: "server_vad",
				interruptResponse: true,
				createResponse: true,
				idleTimeoutMs: 6000,
			},
		}),
		conversationModel,
		"session.audio.input.turn_detection.idle_timeout_ms",
	);
	refuses(conversation(), translate, "session.translation");
	refuses(
		conversation({ translation: { targetLanguage: "es" } }),
		conversationModel,
		"session.translation",
	);
	assertRealtimeConversationSupported(
		conversation({ translation: { targetLanguage: "es" } }),
		translate,
	);
	refuses(
		conversation({ translation: { targetLanguage: "es" }, instructions: "x" }),
		translate,
		"session.instructions",
	);
	refuses(
		conversation({ translation: { targetLanguage: "es" }, vad: null }),
		translate,
		"session.audio.input.turn_detection",
	);
	refuses(
		conversation(),
		resolveModelMetadata("googleaistudio", "gemini-3.5-transcribe-live"),
		"model",
	);
});

test("realtime conversation: OpenAI's realtime models take speed, deferred responses and xhigh", () => {
	const openai = resolveModelMetadata("openai", "gpt-realtime-2.1");
	assertRealtimeConversationSupported(
		conversation({
			voice: "marin",
			speed: 1.3,
			reasoningEffort: "xhigh",
			vad: {
				type: "server_vad",
				interruptResponse: true,
				createResponse: false,
			},
			outputModality: "text",
		}),
		openai,
	);
	assert.throws(
		() =>
			assertRealtimeConversationSupported(
				conversation({ voice: "Kore" }),
				openai,
			),
		(error: unknown) =>
			error instanceof GatewayError &&
			error.param === "session.audio.output.voice",
	);
	assert.throws(
		() =>
			assertRealtimeConversationSupported(
				conversation({ reasoningEffort: "low" }),
				resolveModelMetadata("openai", "gpt-realtime-1.5"),
			),
		(error: unknown) =>
			error instanceof GatewayError &&
			error.param === "session.reasoning.effort",
	);
});
