import { makeOpenAIStyleAdapter } from "#adapters/openaiStyle.ts";
import { looksLikeContextWindowError } from "#core/httpError.ts";
import type { ProviderModule } from "#adapters/types.ts";
import type { ErrorClass } from "#core/errors.ts";

/** Refines a 400 based on OpenAI's code (context window / content policy). */
function refineBadRequest(message: string, body: unknown): ErrorClass | null {
	const code = (body as { error?: { code?: string } })?.error?.code;
	// The /responses transport does not always fill `code`; we fall back to the message.
	if (
		code === "context_length_exceeded" ||
		looksLikeContextWindowError(message)
	) {
		return "context_window";
	}
	if (code === "content_policy_violation" || code === "content_filter") {
		return "content_policy";
	}
	return null;
}

/**
 * Adapter for the real OpenAI API. Its native UPSTREAM transport is /responses (whether the client
 * uses chat or responses, internally it speaks /responses). Error refinement by code.
 */
export const openaiAdapter = makeOpenAIStyleAdapter({
	key: "openai",
	label: "OpenAI",
	defaultBaseUrl: "https://api.openai.com/v1",
	defaultTransport: "responses",
	supportedChatTransports: ["responses", "chat_completions"],
	responsesWebSocket: true,
	contentInputs: {
		responses: {
			file: {
				sources: ["provider_file_id", "url", "data_url"],
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
	maxTokensField: "max_completion_tokens",
	supportsDeveloperRole: true,
	sendOrganization: true,
	refineBadRequest,
	imageTransports: ["images"],
	defaultImageTransport: "images",
	videoTransports: ["videos"],
	defaultVideoTransport: "videos",
	audioTranscriptions: true,
	embeddings: true,
});

export const openaiProvider: ProviderModule = { adapter: openaiAdapter };
