/**
 * UPSTREAM TRANSPORT: the interface an adapter uses to talk to the provider. Resolved by CallType,
 * independent of the public endpoint that renders the canonical result.
 *   - chat_completions: POST /chat/completions (OpenAI and compatibles)
 *   - responses:        POST /responses (OpenAI native)
 *   - generate_content: Google AI Studio (Gemini)
 *   - messages:         Anthropic
 *   - images:           OpenAI Images API (/images/generations and /images/edits)
 *   - audio_transcriptions: OpenAI Audio API (/audio/transcriptions, multipart)
 *   - azure_audio_transcriptions_legacy: Azure deployment-based Audio API
 *   - embeddings:       OpenAI-compatible Embeddings API (/embeddings)
 *   - embed_content:    Google Gemini Embeddings API (:embedContent/:batchEmbedContents)
 *   - openrouter_rerank: OpenRouter Rerank API (/rerank)
 *   - cohere_rerank:     Cohere-compatible Rerank API (/rerank)
 *   - videos:           OpenAI-compatible Videos API (/videos)
 *   - videos_async:     Async job Videos API (POST /videos -> 202 + polling_url, GET /videos/{job},
 *                       GET /videos/{job}/content?index=N)
 *   - generate_videos:  Google Veo long-running video generation (:predictLongRunning)
 */
export type UpstreamTransport =
	| "chat_completions"
	| "responses"
	| "generate_content"
	| "messages"
	| "images"
	| "audio_transcriptions"
	| "azure_audio_transcriptions_legacy"
	| "embeddings"
	| "embed_content"
	| "openrouter_rerank"
	| "cohere_rerank"
	| "videos"
	| "videos_async"
	| "generate_videos";

const UPSTREAM_TRANSPORTS: readonly UpstreamTransport[] = [
	"chat_completions",
	"responses",
	"generate_content",
	"messages",
	"images",
	"audio_transcriptions",
	"azure_audio_transcriptions_legacy",
	"embeddings",
	"embed_content",
	"openrouter_rerank",
	"cohere_rerank",
	"videos",
	"videos_async",
	"generate_videos",
] as const;

export function isUpstreamTransport(
	value: unknown,
): value is UpstreamTransport {
	return (
		typeof value === "string" &&
		(UPSTREAM_TRANSPORTS as readonly string[]).includes(value)
	);
}

/** Transports supported by an adapter and which one it uses by default. */
export interface AdapterTransports {
	supported: readonly UpstreamTransport[];
	default: UpstreamTransport;
}

export function nativeTransportForPublicWire(
	wire: "chat_completions" | "responses" | "messages",
): UpstreamTransport {
	return wire;
}
