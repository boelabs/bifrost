import { callTypeForOperation, OPERATION_IDS } from "#operations/registry.ts";
import type { EmbeddingProfile } from "#core/embeddings.ts";
import type { TextCapabilities } from "#core/reasoning.ts";
import type { RuntimeModelMetadata } from "#db/schema.ts";
import type { ImageModelProfile } from "#core/images.ts";
import type { VideoModelProfile } from "#core/videos.ts";
import type { OperationProfiles } from "./types.ts";
import type { CallType } from "#core/callType.ts";

function mergeImageProfile(
	base: ImageModelProfile | undefined,
	override: ImageModelProfile | undefined,
): ImageModelProfile | undefined {
	if (!(base || override)) {
		return undefined;
	}
	return {
		...(base ?? {}),
		...(override ?? {}),
		...(base?.sizes || override?.sizes
			? { sizes: { ...(base?.sizes ?? {}), ...(override?.sizes ?? {}) } }
			: {}),
		...(base?.arbitrarySize || override?.arbitrarySize
			? {
					arbitrarySize: {
						...base?.arbitrarySize,
						...override?.arbitrarySize,
					} as NonNullable<ImageModelProfile["arbitrarySize"]>,
				}
			: {}),
	};
}

function mergeVideoProfile(
	base: VideoModelProfile | undefined,
	override: VideoModelProfile | undefined,
): VideoModelProfile | undefined {
	if (!(base || override)) {
		return undefined;
	}
	return {
		...(base ?? {}),
		...(override ?? {}),
		...(base?.sizes || override?.sizes
			? { sizes: { ...(base?.sizes ?? {}), ...(override?.sizes ?? {}) } }
			: {}),
	};
}

/** CallTypes derived from which operations are present in the map. */
function profileSupportedCallTypes(operations: OperationProfiles): CallType[] {
	const supportedCallTypes: CallType[] = [];
	for (const operation of OPERATION_IDS) {
		if (operations[operation] === undefined) {
			continue;
		}
		const callType = callTypeForOperation(operation);
		if (callType) {
			supportedCallTypes.push(callType);
		}
	}
	return supportedCallTypes;
}

/**
 * Flattens an `OperationProfiles` map (+ pricing) to the runtime view `RuntimeModelMetadata`: today a
 * request points to one operation, so the text fields (capabilities/limits/reasoning) and the image
 * profile are hoisted for adapters to read. The declarative source stays per-operation.
 */
/** What a model that only produces media can do with the text half of a request: read it. */
const MEDIA_ONLY_CAPABILITIES = {
	tools: false,
	vision: true,
	reasoning: false,
	structuredOutputs: false,
} as const;

/**
 * The input limit, from whichever operation states one.
 *
 * Rerank counts its limit per document rather than per request, but it is still the only number
 * the model will accept, so it stands in when there is no text operation to ask.
 */
function maxInputTokensField(
	textLimit: number | undefined,
	rerankLimit: number | undefined,
): { maxInputTokens?: number } {
	if (textLimit !== undefined) {
		return { maxInputTokens: textLimit };
	}
	return rerankLimit === undefined ? {} : { maxInputTokens: rerankLimit };
}

export function profileToRuntimeMetadata(profile: {
	operations: OperationProfiles;
	pricing?: RuntimeModelMetadata["pricing"];
}): RuntimeModelMetadata {
	const { operations } = profile;
	const text = operations["text.generate"];
	const imageGeneration = operations["image.generate"];
	const imageEdit = operations["image.edit"];
	const videoGeneration = operations["video.generate"];
	const embedding = operations["embedding.create"];
	const { rerank } = operations;
	// A model that only makes pictures or video reads its prompt but has none of the text
	// controls, and nothing else in the catalog says so on its behalf.
	const mediaOnlyCapabilities =
		imageGeneration || imageEdit || videoGeneration
			? MEDIA_ONLY_CAPABILITIES
			: undefined;
	const capabilities: Partial<TextCapabilities> | undefined =
		text?.capabilities ?? mediaOnlyCapabilities;
	const image = mergeImageProfile(imageGeneration, imageEdit);
	const video = mergeVideoProfile(videoGeneration, undefined);
	return {
		supportedCallTypes: profileSupportedCallTypes(operations),
		operations: structuredClone(operations),
		...(capabilities ? { capabilities } : {}),
		...maxInputTokensField(text?.maxInputTokens, rerank?.maxTokensPerDocument),
		...(text?.maxOutputTokens === undefined
			? {}
			: { maxOutputTokens: text.maxOutputTokens }),
		...(text?.reasoning === undefined ? {} : { reasoning: text.reasoning }),
		...(image ? { image } : {}),
		...(video ? { video } : {}),
		...(embedding ? { embedding: embedding as EmbeddingProfile } : {}),
		...(rerank ? { rerank } : {}),
		...(profile.pricing === undefined ? {} : { pricing: profile.pricing }),
	};
}
