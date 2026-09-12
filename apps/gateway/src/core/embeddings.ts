import type { Usage } from "./usage.ts";

type EmbeddingEncodingFormat = "float" | "base64";
export type EmbeddingInput = string | string[] | number[] | number[][];
export type EmbeddingVector = number[] | string;

export interface CanonicalEmbeddingsRequest {
	model: string;
	input: EmbeddingInput;
	encodingFormat: EmbeddingEncodingFormat;
	dimensions?: number;
	user?: string;
	extraBody?: Record<string, unknown>;
}

interface CanonicalEmbeddingData {
	index: number;
	embedding: EmbeddingVector;
}

export interface EmbeddingsUsage {
	promptTokens: number;
	totalTokens: number;
}

export interface CanonicalEmbeddingsResponse {
	model: string;
	data: CanonicalEmbeddingData[];
	usage?: EmbeddingsUsage;
}

/**
 * Canonical constraints of an embeddings model. Exact tokenization stays at the upstream; here we
 * validate the declarative bits and a few coarse guards to avoid absurd payloads.
 */
export interface EmbeddingProfile {
	/** The model's native dimension, when known. */
	dimensions?: number;
	/** Allows requesting `dimensions`; usually only text-embedding-3+ models. */
	supportsDimensions?: boolean;
	minDimensions?: number;
	maxDimensions?: number;
	encodingFormats?: EmbeddingEncodingFormat[];
	/** Maximum input batch; a string or number[] counts as 1. */
	maxInputs?: number;
	/** Documented per-input limit; informational/operational, not tokenized locally. */
	maxInputTokens?: number;
	/** Documented aggregate limit; informational/operational, not tokenized locally. */
	maxTotalTokens?: number;
	/** Coarse local guard on serialized bytes per input. */
	maxInputBytes?: number;
	/** Coarse local guard on total serialized bytes. */
	maxTotalInputBytes?: number;
	/** If false, pre-tokenized number[] / number[][] inputs are rejected. */
	supportsTokenInput?: boolean;
}

export function embeddingsUsageToCore(
	u: EmbeddingsUsage | undefined,
): Usage | null {
	if (!u) return null;
	return {
		promptTokens: u.promptTokens,
		completionTokens: 0,
		totalTokens: u.totalTokens,
	};
}
