import type { CanonicalRealtimeTranscriptionConfig } from "#core/realtime.ts";
import { realtimeTranscriptionProfileFor } from "#catalog/types.ts";
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
