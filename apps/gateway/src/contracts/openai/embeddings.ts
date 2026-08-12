import { assertNoManagedExtraBodyKeys } from "#core/extraBody.ts";
import * as z from "zod/v4";

import type {
	CanonicalEmbeddingsResponse,
	CanonicalEmbeddingsRequest,
	EmbeddingInput,
} from "#core/embeddings.ts";

const tokenSchema = z.int().nonnegative();
const tokenArraySchema = z.array(tokenSchema).min(1);
const inputSchema = z.union([
	z.string().min(1),
	z.array(z.string().min(1)).min(1),
	tokenArraySchema,
	z.array(tokenArraySchema).min(1),
]);

const EMBEDDINGS_EXTRA_BODY_MANAGED_KEYS = [
	"model",
	"input",
	"encoding_format",
	"dimensions",
	"user",
	"extra_body",
] as const;

export const embeddingsRequestSchema = z
	.object({
		model: z.string().min(1),
		input: inputSchema,
		encoding_format: z.enum(["float", "base64"]).optional().default("float"),
		dimensions: z.int().positive().optional(),
		user: z.string().optional(),
		extra_body: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export type OpenAIEmbeddingsRequest = z.infer<typeof embeddingsRequestSchema>;

export function embeddingsRequestToCanonical(
	req: OpenAIEmbeddingsRequest,
): CanonicalEmbeddingsRequest {
	if (req.extra_body !== undefined) {
		assertNoManagedExtraBodyKeys(
			req.extra_body,
			EMBEDDINGS_EXTRA_BODY_MANAGED_KEYS,
		);
	}
	return {
		model: req.model,
		input: req.input as EmbeddingInput,
		encodingFormat: req.encoding_format,
		...(req.dimensions !== undefined ? { dimensions: req.dimensions } : {}),
		...(req.user !== undefined ? { user: req.user } : {}),
		...(req.extra_body !== undefined ? { extraBody: req.extra_body } : {}),
	};
}

export function toOpenAIEmbeddingsResponse(
	response: CanonicalEmbeddingsResponse,
): Record<string, unknown> {
	return {
		object: "list",
		data: response.data.map((item) => ({
			object: "embedding",
			embedding: item.embedding,
			index: item.index,
		})),
		model: response.model,
		...(response.usage
			? {
					usage: {
						prompt_tokens: response.usage.promptTokens,
						total_tokens: response.usage.totalTokens,
					},
				}
			: {}),
	};
}
