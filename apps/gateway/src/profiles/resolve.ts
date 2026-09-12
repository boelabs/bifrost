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
	if (!base && !override) return undefined;
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
	if (!base && !override) return undefined;
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
		if (operations[operation] === undefined) continue;
		const callType = callTypeForOperation(operation);
		if (callType) supportedCallTypes.push(callType);
	}
	return supportedCallTypes;
}

/**
 * Flattens an `OperationProfiles` map (+ pricing) to the runtime view `RuntimeModelMetadata`: today a
 * request points to one operation, so the text fields (capabilities/limits/reasoning) and the image
 * profile are hoisted for adapters to read. The declarative source stays per-operation.
 */
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
	const rerank = operations.rerank;
	const capabilities: Partial<TextCapabilities> | undefined =
		text?.capabilities ??
		(imageGeneration || imageEdit
			? {
					tools: false,
					vision: true,
					reasoning: false,
					structuredOutputs: false,
				}
			: videoGeneration
				? {
						tools: false,
						vision: true,
						reasoning: false,
						structuredOutputs: false,
					}
				: undefined);
	const image = mergeImageProfile(imageGeneration, imageEdit);
	const video = mergeVideoProfile(videoGeneration, undefined);
	return {
		supportedCallTypes: profileSupportedCallTypes(operations),
		operations: structuredClone(operations),
		...(capabilities ? { capabilities } : {}),
		...(text?.maxInputTokens !== undefined
			? { maxInputTokens: text.maxInputTokens }
			: rerank?.maxTokensPerDocument !== undefined
				? { maxInputTokens: rerank.maxTokensPerDocument }
				: {}),
		...(text?.maxOutputTokens !== undefined
			? { maxOutputTokens: text.maxOutputTokens }
			: {}),
		...(text?.reasoning !== undefined ? { reasoning: text.reasoning } : {}),
		...(image ? { image } : {}),
		...(video ? { video } : {}),
		...(embedding ? { embedding: embedding as EmbeddingProfile } : {}),
		...(rerank ? { rerank } : {}),
		...(profile.pricing !== undefined ? { pricing: profile.pricing } : {}),
	};
}
