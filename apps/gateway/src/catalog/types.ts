import type { TextCapabilities, ReasoningSpec } from "#core/reasoning.ts";
import type { OperationProfiles } from "#profiles/types.ts";
import type { EmbeddingProfile } from "#core/embeddings.ts";
import type { TranscriptionProfile } from "#core/audio.ts";
import type { RuntimeModelMetadata } from "#db/schema.ts";
import type { ImageModelProfile } from "#core/images.ts";
import type { VideoModelProfile } from "#core/videos.ts";
import type { RerankProfile } from "#core/rerank.ts";
import type { CallType } from "#core/callType.ts";

/**
 * Catalog entry for known models. Lives in CODE (like the adapters) and describes what a model can do
 * DECLARATIVELY AND PER OPERATION: `operations` maps each operation (text.generate, image.generate,
 * audio.transcribe, ...) to its profile (capabilities, limits, reasoning control, image restrictions...).
 * Same shape as the operator's override in the DB (`model_deployments.catalogEntry` for custom), so a
 * model of any modality is declared the same way.
 * The DB pricing can override these defaults (see resolveModelMetadata).
 */
export interface CatalogEntry {
	/** Free-form human notes (e.g. why a model is deprecated, review reminders). */
	notes?: string;
	operations: OperationProfiles;
	pricing?: RuntimeModelMetadata["pricing"];
	/** Flagged as not recommended (does not affect behavior). */
	deprecated?: boolean;
	/**
	 * Dot-paths (e.g. "operations.text.generate.reasoning") the catalog sync auto-drafted from a source
	 * that can't express our exact schema (currently: reasoning specs from models.dev's `reasoning_options`).
	 * `scripts/validate-catalog.ts` fails the build while this is non-empty, so a drafted field can't reach
	 * production unreviewed. Never set by hand - a human clears it once they've verified the field against
	 * the provider's docs.
	 */
	needsHumanReview?: string[];
}

/**
 * Resolved metadata of a deployment: catalog or custom CatalogEntry, plus the operator's pricing.
 * They travel via AdapterContext and feed validation, adapters, and cost calculation.
 */
export interface ResolvedModelMetadata {
	capabilities: TextCapabilities;
	supportedCallTypes?: CallType[];
	image?: ImageModelProfile;
	video?: VideoModelProfile;
	embedding?: EmbeddingProfile;
	rerank?: RerankProfile;
	operations?: OperationProfiles;
	pricing?: RuntimeModelMetadata["pricing"];
	maxInputTokens?: number;
	maxOutputTokens?: number;
	reasoning?: ReasoningSpec;
}

export function imageProfileFor(
	meta: ResolvedModelMetadata,
	operation: "generation" | "edit",
): ImageModelProfile | undefined {
	const operationId =
		operation === "generation" ? "image.generate" : "image.edit";
	return (
		(meta.operations?.[operationId] as ImageModelProfile | undefined) ??
		meta.image
	);
}

export function transcriptionProfileFor(
	meta: ResolvedModelMetadata,
): TranscriptionProfile | undefined {
	return meta.operations?.["audio.transcribe"] as
		| TranscriptionProfile
		| undefined;
}

export function videoProfileFor(
	meta: ResolvedModelMetadata,
): VideoModelProfile | undefined {
	return (
		(meta.operations?.["video.generate"] as VideoModelProfile | undefined) ??
		meta.video
	);
}

export function embeddingProfileFor(
	meta: ResolvedModelMetadata,
): EmbeddingProfile | undefined {
	return (
		(meta.operations?.["embedding.create"] as EmbeddingProfile | undefined) ??
		meta.embedding
	);
}

export function rerankProfileFor(
	meta: ResolvedModelMetadata,
): RerankProfile | undefined {
	return (meta.operations?.rerank as RerankProfile | undefined) ?? meta.rerank;
}
