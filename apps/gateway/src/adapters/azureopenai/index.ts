import type { Adapter, ProviderModule } from "#adapters/types.ts";
import { makeAzureTranscriptionHandler } from "./audio.ts";
import { makeAzurev1Adapter } from "#adapters/azurev1.ts";

const LABEL = "Azure OpenAI v1";

/** Chat/Responses/image over /openai/v1; transcriptions use the classic API (see ./audio). */
const base = makeAzurev1Adapter({
	key: "azureopenai",
	label: LABEL,
	defaultTransport: "responses",
	supportedChatTransports: ["responses", "chat_completions"],
	contentInputs: {
		responses: {
			file: {
				sources: ["provider_file_id", "data_url"],
				maxBytes: 50_000_000,
			},
		},
		chat_completions: {
			file: {
				sources: ["provider_file_id", "data_url"],
				maxBytes: 50_000_000,
			},
		},
	},
	embeddings: true,
});

/**
 * Modern Azure OpenAI with one special case: audio transcription still requires the classic
 * deployment-based API (it does not exist on /openai/v1), so it is composed separately on top of the
 * base v1 adapter.
 */
export const azureopenaiAdapter: Adapter = {
	...base,
	supportedCallTypes: new Set([
		...base.supportedCallTypes,
		"audio.transcriptions",
	]),
	audioTranscription: makeAzureTranscriptionHandler(LABEL),
	transports: {
		...base.transports,
		"audio.transcriptions": {
			supported: ["audio_transcriptions"],
			default: "audio_transcriptions",
		},
	},
};

export const azureopenaiProvider: ProviderModule = {
	adapter: azureopenaiAdapter,
};
