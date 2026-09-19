import type { CostBreakdown } from "#logging/cost.ts";
import { z } from "zod/v4";

import type {
	RerankProviderPreferences,
	CanonicalRerankResponse,
	CanonicalRerankRequest,
} from "#core/rerank.ts";

const nonBlank = z
	.string()
	.min(1)
	.refine((value) => value.trim().length > 0, {
		message: "must not be blank",
	});

const percentileCutoffs = z
	.object({
		p50: z.number().nonnegative().nullable().optional(),
		p75: z.number().nonnegative().nullable().optional(),
		p90: z.number().nonnegative().nullable().optional(),
		p99: z.number().nonnegative().nullable().optional(),
	})
	.strict();

const maxPrice = z
	.object({
		audio: z.string().min(1).optional(),
		completion: z.string().min(1).optional(),
		image: z.string().min(1).optional(),
		prompt: z.string().min(1).optional(),
		request: z.string().min(1).optional(),
	})
	.strict();

const sortConfig = z
	.object({
		by: z.string().nullable().optional(),
		partition: z.enum(["model", "none"]).nullable().optional(),
	})
	.strict();

export const rerankProviderPreferencesSchema = z
	.object({
		allow_fallbacks: z.boolean().nullable().optional(),
		data_collection: z.enum(["allow", "deny"]).nullable().optional(),
		enforce_distillable_text: z.boolean().nullable().optional(),
		ignore: z.array(z.string().min(1)).nullable().optional(),
		max_price: maxPrice.optional(),
		only: z.array(z.string().min(1)).nullable().optional(),
		order: z.array(z.string().min(1)).nullable().optional(),
		preferred_max_latency: z
			.union([z.number().nonnegative(), percentileCutoffs])
			.nullable()
			.optional(),
		preferred_min_throughput: z
			.union([z.number().nonnegative(), percentileCutoffs])
			.nullable()
			.optional(),
		quantizations: z.array(z.string().min(1)).nullable().optional(),
		require_parameters: z.boolean().nullable().optional(),
		sort: z
			.union([z.string().min(1), sortConfig])
			.nullable()
			.optional(),
		zdr: z.boolean().nullable().optional(),
	})
	.strict();

const documentSchema = z.union([
	nonBlank,
	z.object({ text: nonBlank }).strict(),
]);

export const rerankRequestSchema = z
	.object({
		model: nonBlank,
		query: nonBlank,
		documents: z.array(documentSchema).min(1).max(1000),
		top_n: z.int().positive().optional(),
		provider: rerankProviderPreferencesSchema.optional(),
	})
	.strict();

export type OpenRouterRerankRequest = z.infer<typeof rerankRequestSchema>;

export function rerankRequestToCanonical(
	request: OpenRouterRerankRequest,
): CanonicalRerankRequest {
	return {
		model: request.model,
		query: request.query,
		documents: request.documents.map((document) => ({
			type: "text" as const,
			text: typeof document === "string" ? document : document.text,
		})),
		...(request.top_n === undefined ? {} : { topN: request.top_n }),
		...(request.provider === undefined
			? {}
			: { provider: request.provider as RerankProviderPreferences }),
	};
}

/** One document echoed back, under the key its own kind gives the payload. */
function renderedDocument(
	document: CanonicalRerankRequest["documents"][number],
): Record<string, unknown> {
	if (document.type === "text") {
		return { text: document.text };
	}
	const text = document.text ? { text: document.text } : {};
	return document.type === "image_url"
		? { ...text, image: document.url }
		: { ...text, image: document.dataUrl };
}

export function toOpenRouterRerankResponse(
	request: CanonicalRerankRequest,
	response: CanonicalRerankResponse,
	cost: CostBreakdown | null,
): Record<string, unknown> {
	const { usage } = response;
	return {
		...(response.id === undefined ? {} : { id: response.id }),
		model: request.model,
		...(response.provider === undefined ? {} : { provider: response.provider }),
		results: response.results.map((result) => {
			const document = request.documents[result.index]!;
			return {
				index: result.index,
				relevance_score: result.relevanceScore,
				document: renderedDocument(document),
			};
		}),
		...(usage || cost
			? {
					usage: {
						...(usage ? { total_tokens: usage.totalTokens } : {}),
						...(usage?.searchUnits === undefined
							? {}
							: { search_units: usage.searchUnits }),
						...(cost ? { cost: cost.totalCents / 100 } : {}),
					},
				}
			: {}),
	};
}
