import type {
	CanonicalRealtimeConversationConfig,
	CanonicalRealtimeTranscriptionConfig,
} from "#core/realtime.ts";
import {
	realtimeConversationProfileFor,
	realtimeTranscriptionProfileFor,
} from "#catalog/types.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import { GatewayError } from "#core/errors.ts";

function unsupported(param: string, message: string): never {
	throw new GatewayError({
		class: "bad_request",
		message,
		code: "unsupported_parameter",
		param,
		publicMessage: message,
	});
}

/** Rejects a session configuration the selected model cannot honor, before the provider sees it. */
export function assertRealtimeConfigSupported(
	config: CanonicalRealtimeTranscriptionConfig,
	meta: ResolvedModelMetadata,
): void {
	const profile = realtimeTranscriptionProfileFor(meta);
	if (!profile) {
		unsupported(
			"session.audio.input.transcription.model",
			"The selected model does not support realtime transcription.",
		);
	}
	if (
		config.mode !== undefined &&
		config.mode !== "verbatim" &&
		!(profile.modes ?? []).includes(config.mode)
	) {
		unsupported(
			"session.audio.input.transcription.transcription_mode",
			`The selected model does not support transcription_mode=${config.mode}.`,
		);
	}
	if (
		profile.turnDetection &&
		!profile.turnDetection.includes(config.turnDetection)
	) {
		unsupported(
			"session.audio.input.turn_detection",
			config.turnDetection === "manual"
				? "The selected model requires turn_detection; it cannot be null."
				: "The selected model requires turn_detection to be null.",
		);
	}
	if (
		profile.supportsKeywords &&
		profile.maxKeywords !== undefined &&
		(config.keywords?.length ?? 0) > profile.maxKeywords
	) {
		unsupported(
			"session.audio.input.transcription.keywords",
			`The selected model accepts at most ${profile.maxKeywords} keywords.`,
		);
	}
}

/** Rejects a conversation configuration the selected model cannot honor, before the provider sees it. */
export function assertRealtimeConversationSupported(
	config: CanonicalRealtimeConversationConfig,
	meta: ResolvedModelMetadata,
): void {
	const profile = realtimeConversationProfileFor(meta);
	if (!profile) {
		unsupported(
			"model",
			"The selected model does not support realtime conversations.",
		);
	}
	if (
		config.outputModality === "audio" &&
		!profile.outputModalities.includes("audio")
	) {
		unsupported(
			"session.output_modalities",
			"The selected model only answers in text.",
		);
	}
	if (config.voice !== undefined && !profile.voices?.includes(config.voice)) {
		unsupported(
			"session.audio.output.voice",
			profile.voices
				? `The selected model does not have the voice '${config.voice}'. Available voices: ${profile.voices.join(", ")}.`
				: "The selected model's voice cannot be chosen.",
		);
	}
	if (config.speed !== undefined && !profile.supportsSpeed) {
		unsupported(
			"session.audio.output.speed",
			"The selected model cannot change its speaking speed.",
		);
	}
	const turnDetection = config.vad?.type ?? "manual";
	if (profile.turnDetection && !profile.turnDetection.includes(turnDetection)) {
		unsupported(
			"session.audio.input.turn_detection",
			`The selected model does not support turn_detection ${config.vad ? `'${config.vad.type}'` : "null"}.`,
		);
	}
	if (
		config.vad &&
		!config.vad.createResponse &&
		!profile.supportsDeferredResponse
	) {
		unsupported(
			"session.audio.input.turn_detection.create_response",
			"The selected model always answers when the user's turn ends; create_response cannot be false.",
		);
	}
	if (config.vad?.idleTimeoutMs !== undefined) {
		unsupported(
			"session.audio.input.turn_detection.idle_timeout_ms",
			"The selected model does not support idle_timeout_ms.",
		);
	}
	if (config.instructions !== undefined && !profile.supportsInstructions) {
		unsupported(
			"session.instructions",
			"The selected model does not accept instructions.",
		);
	}
	if (config.tools.length > 0 && !profile.supportsTools) {
		unsupported("session.tools", "The selected model does not support tools.");
	}
	if (config.googleSearch && !profile.supportsGoogleSearch) {
		unsupported(
			"session.tools",
			"The selected model does not support the google_search tool.",
		);
	}
	if (
		config.reasoningEffort !== undefined &&
		!profile.reasoningEfforts?.includes(config.reasoningEffort)
	) {
		unsupported(
			"session.reasoning.effort",
			profile.reasoningEfforts
				? `The selected model accepts reasoning.effort ${profile.reasoningEfforts.join(", ")}.`
				: "The selected model's reasoning effort cannot be set.",
		);
	}
	if (config.inputTranscription && !profile.supportsInputTranscription) {
		unsupported(
			"session.audio.input.transcription",
			"The selected model does not transcribe input audio.",
		);
	}
	if (
		profile.maxKeywords !== undefined &&
		(config.inputTranscription?.keywords?.length ?? 0) > profile.maxKeywords
	) {
		unsupported(
			"session.audio.input.transcription.keywords",
			`The selected model accepts at most ${profile.maxKeywords} keywords.`,
		);
	}
	if (profile.translation && !config.translation) {
		unsupported(
			"session.translation",
			"The selected model translates speech: set session.translation.target_language.",
		);
	}
	if (!profile.translation && config.translation) {
		unsupported(
			"session.translation",
			"The selected model does not translate speech.",
		);
	}
}
