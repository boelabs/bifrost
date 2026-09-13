import { type GatewayRequest, gatewayJson } from "./gateway";
import { z } from "zod";

/**
 * Reranking: one query, a pile of documents, and the order the model puts them in.
 *
 * The answer is a permutation with scores, so the playground shows the documents in the model's
 * order with their original position kept visible — what moved is the whole point, and a list that
 * has forgotten where each entry came from cannot show it.
 */

export interface RerankSettings {
	topN?: number;
}

export const emptyRerankSettings = (): RerankSettings => ({});

export interface RerankRun {
	id: string;
	query: string;
	documents: string[];
	model: string;
	settings: RerankSettings;
	state: "running" | "completed" | "failed" | "stopped";
	results: RankedDocument[];
	error?: string;
	durationMs?: number;
	totalTokens?: number;
	searchUnits?: number;
}

export interface RankedDocument {
	/** Where this document was in the request, so a move can be seen. */
	index: number;
	score: number;
	text: string;
}

const rerankResponse = z.object({
	model: z.string().optional(),
	results: z.array(
		z.object({
			index: z.number(),
			relevance_score: z.number().optional(),
			score: z.number().optional(),
			document: z
				.union([z.string(), z.object({ text: z.string().optional() })])
				.optional(),
		}),
	),
	usage: z
		.object({
			total_tokens: z.number().optional(),
			search_units: z.number().optional(),
		})
		.optional(),
});

export type RerankResponse = z.infer<typeof rerankResponse>;

export function rerankBody(
	model: string,
	query: string,
	documents: string[],
	settings: RerankSettings,
): Record<string, unknown> {
	return {
		model,
		query,
		documents,
		...(settings.topN !== undefined ? { top_n: settings.topN } : {}),
	};
}

/**
 * The ranking, against the documents that were sent.
 *
 * A provider may or may not echo the text back; the request is the authority either way, so the
 * document is read from what was asked rather than from what came back.
 */
export function rankingFrom(
	response: RerankResponse,
	documents: string[],
): RankedDocument[] {
	return response.results.flatMap((result): RankedDocument[] => {
		const text =
			documents[result.index] ??
			(typeof result.document === "string"
				? result.document
				: result.document?.text);
		return text === undefined
			? []
			: [
					{
						index: result.index,
						score: result.relevance_score ?? result.score ?? 0,
						text,
					},
				];
	});
}

export async function runRerank(
	input: {
		model: string;
		query: string;
		documents: string[];
		settings: RerankSettings;
	},
	options: GatewayRequest = {},
): Promise<RerankResponse> {
	return rerankResponse.parse(
		await gatewayJson<unknown>(
			"/rerank",
			rerankBody(input.model, input.query, input.documents, input.settings),
			options,
		),
	);
}
