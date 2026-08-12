import type { TextCapabilities, ReasoningSpec } from "#core/reasoning.ts";
import type { ParameterSupportMap } from "#catalog/parameters.ts";
import type { EmbeddingProfile } from "#core/embeddings.ts";
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

export interface OperationProfiles {
	"text.generate"?: TextGenerateProfile;
	"image.generate"?: ImageModelProfile;
	"image.edit"?: ImageModelProfile;
	"video.generate"?: VideoModelProfile;
	"audio.transcribe"?: TranscriptionProfile;
	"embedding.create"?: EmbeddingProfile;
	rerank?: RerankProfile;
}

export type TransportOverrides = Partial<Record<OperationId, string>>;
