import type { TextCapabilities, ReasoningSpec } from "#core/reasoning.ts";
import type { ParameterSupportMap } from "#catalog/parameters.ts";
import type { EmbeddingProfile } from "#core/embeddings.ts";
import type { UpstreamTransport } from "#core/transport.ts";
import type { TranscriptionProfile } from "#core/audio.ts";
import type { OperationId } from "#operations/registry.ts";
import type { ImageModelProfile } from "#core/images.ts";
import type { VideoModelProfile } from "#core/videos.ts";
import type { RerankProfile } from "#core/rerank.ts";

interface TextGenerateProfile {
	// Client contract.
	capabilities?: Partial<TextCapabilities>;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	modalities?: {
		input?: Array<
			| "text"
			| "image"
			| "audio"
			| "video"
			| "pdf"
			| "file"
			| "embedding"
			| "moderation"
		>;
		output?: Array<
			| "text"
			| "image"
			| "audio"
			| "video"
			| "pdf"
			| "file"
			| "embedding"
			| "moderation"
		>;
	};
	contracts?: Array<
		| "chat.completions"
		| "responses"
		| "messages"
		| "images.generations"
		| "images.edits"
		| "audio.transcriptions"
		| "videos"
	>;
	parameters?: ParameterSupportMap;
	// ── Gateway behavior: how the reasoning control is translated to the provider ──
	reasoning?: ReasoningSpec;
}

/**
 * The upstream protocol a model speaks for one operation.
 *
 * Only meaningful where a provider serves the same operation through more than one API, and only
 * when the choice belongs to the MODEL rather than to the account: Google runs Veo on
 * `:predictLongRunning` and its omni models on `/interactions`, and no operator configuration can
 * change which of the two a given model answers on. Azure's legacy transcription API is the
 * opposite case — a property of the resource, which is why it stays a deployment override.
 *
 * Left out, the adapter's default stands. An operator override still wins over both: it is the
 * escape hatch for a deployment that knows something the catalog does not.
 */
export interface OperationTransport {
	transport?: UpstreamTransport;
}

export interface OperationProfiles {
	"text.generate"?: TextGenerateProfile & OperationTransport;
	"image.generate"?: ImageModelProfile & OperationTransport;
	"image.edit"?: ImageModelProfile & OperationTransport;
	"video.generate"?: VideoModelProfile & OperationTransport;
	"audio.transcribe"?: TranscriptionProfile & OperationTransport;
	"embedding.create"?: EmbeddingProfile & OperationTransport;
	rerank?: RerankProfile & OperationTransport;
}

export type TransportOverrides = Partial<Record<OperationId, string>>;
