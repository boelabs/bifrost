import type { Adapter, ProviderModule } from "#adapters/types.ts";
import { makeAzureTranscriptionHandler } from "./audio.ts";
import { makeAzurev1Adapter } from "#adapters/azurev1.ts";

const LABEL = "Azure OpenAI v1";

/** Chat, Responses, embeddings, and transcriptions use Azure's OpenAI-compatible v1 surface. */
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

/** Modern Azure OpenAI, with an explicit legacy transcription transport for compatibility. */
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
			supported: ["audio_transcriptions", "azure_audio_transcriptions_legacy"],
			default: "audio_transcriptions",
		},
	},
};

export const azureopenaiProvider: ProviderModule = {
	adapter: azureopenaiAdapter,
};
