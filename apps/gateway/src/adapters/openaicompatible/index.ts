import { makeOpenAIStyleAdapter } from "#adapters/openaiStyle.ts";
import type { ProviderModule } from "#adapters/types.ts";

/**
 * Generic adapter for any API compatible with OpenAI Chat Completions
 * (xAI, Mistral, Groq, Together, vLLM, Ollama, LM Studio...).
 *
 * Conservative for maximum compatibility: `baseUrl` is REQUIRED in credentials and it uses
 * `max_tokens` (not all accept `max_completion_tokens`). No OpenAI-only features.
 * Since /v1/responses is rendered from the chat handler, it also serves Responses.
 */
export const openaicompatibleAdapter = makeOpenAIStyleAdapter({
	key: "openaicompatible",
	label: "OpenAI-compatible",
	defaultTransport: "chat_completions",
	maxTokensField: "max_tokens",
	imageTransports: ["images", "chat_completions"],
	defaultImageTransport: "images",
	videoTransports: ["videos", "videos_async"],
	defaultVideoTransport: "videos",
	audioTranscriptions: true,
	embeddings: true,
});

// Intentionally no catalog: accepts any model with defaults + whatever the operator declares.
export const openaicompatibleProvider: ProviderModule = {
	adapter: openaicompatibleAdapter,
};
