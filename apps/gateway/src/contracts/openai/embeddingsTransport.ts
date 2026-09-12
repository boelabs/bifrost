import type { CanonicalEmbeddingsResponse } from "#core/embeddings.ts";
import { mergeExtraBodyDeep } from "#core/extraBody.ts";
import { GatewayError } from "#core/errors.ts";

import type {
	CanonicalEmbeddingsRequest,
	EmbeddingVector,
} from "#core/embeddings.ts";

const EMBEDDINGS_MANAGED_KEYS = [
	"model",
	"input",
	"encoding_format",
	"dimensions",
	"user",
] as const;

export function buildEmbeddingsBody(
	req: CanonicalEmbeddingsRequest,
	upstreamModel: string,
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: upstreamModel,
		input: req.input,
		encoding_format: req.encodingFormat,
		...(req.dimensions !== undefined ? { dimensions: req.dimensions } : {}),
		...(req.user !== undefined ? { user: req.user } : {}),
	};
	return mergeExtraBodyDeep(body, req.extraBody, EMBEDDINGS_MANAGED_KEYS);
}

function parseEmbedding(raw: unknown): EmbeddingVector {
	if (typeof raw === "string") return raw;
	if (
		Array.isArray(raw) &&
		raw.every((value) => typeof value === "number" && Number.isFinite(value))
	) {
		return raw;
	}
	throw new GatewayError({
		class: "server",
		message: "Embedding upstream returned an invalid embedding vector",
	});
}

export function parseEmbeddingsResponse(
	raw: unknown,
): CanonicalEmbeddingsResponse {
	const body = (raw ?? {}) as Record<string, unknown>;
	if (!Array.isArray(body.data)) {
		throw new GatewayError({
			class: "server",
			message: "Invalid Embeddings API response",
		});
	}
	const usage = body.usage as
		| { prompt_tokens?: unknown; total_tokens?: unknown }
		| undefined;
	return {
		model: typeof body.model === "string" ? body.model : "",
		data: body.data.map((item, fallbackIndex) => {
			const entry = (item ?? {}) as Record<string, unknown>;
			return {
				index: typeof entry.index === "number" ? entry.index : fallbackIndex,
				embedding: parseEmbedding(entry.embedding),
			};
		}),
		...(typeof usage?.total_tokens === "number"
			? {
					usage: {
						promptTokens:
							typeof usage.prompt_tokens === "number"
								? usage.prompt_tokens
								: usage.total_tokens,
						totalTokens: usage.total_tokens,
					},
				}
			: {}),
	};
}
