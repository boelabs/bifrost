import type { Usage } from "./usage.ts";

export type RerankDocument =
	| { type: "text"; text: string }
	| { type: "image_url"; url: string; text?: string }
	| { type: "image_data_url"; dataUrl: string; text?: string };

export interface RerankProviderPreferences {
	allow_fallbacks?: boolean | null;
	data_collection?: "allow" | "deny" | null;
	enforce_distillable_text?: boolean | null;
	ignore?: string[] | null;
	max_price?: {
		audio?: string;
		completion?: string;
		image?: string;
		prompt?: string;
		request?: string;
	};
	only?: string[] | null;
	order?: string[] | null;
	preferred_max_latency?:
		| number
		| {
				p50?: number | null;
				p75?: number | null;
				p90?: number | null;
				p99?: number | null;
		  }
		| null;
	preferred_min_throughput?:
		| number
		| {
				p50?: number | null;
				p75?: number | null;
				p90?: number | null;
				p99?: number | null;
		  }
		| null;
	quantizations?: string[] | null;
	require_parameters?: boolean | null;
	sort?: string | Record<string, unknown> | null;
	zdr?: boolean | null;
}

export interface CanonicalRerankRequest {
	model: string;
	query: string;
	documents: RerankDocument[];
	topN?: number;
	provider?: RerankProviderPreferences;
}

export interface CanonicalRerankResult {
	index: number;
	relevanceScore: number;
}

export interface CanonicalRerankResponse {
	id?: string;
	provider?: string;
	results: CanonicalRerankResult[];
	usage?: Usage;
}

export interface RerankProfile {
	documentModalities: Array<"text" | "image">;
	imageSources?: Array<"url" | "data_url">;
	maxDocuments?: number;
	maxQueryBytes?: number;
	maxDocumentBytes?: number;
	maxTotalDocumentBytes?: number;
	/** Documented upstream limit; the gateway does not tokenize locally. */
	maxTokensPerDocument?: number;
	/** Documented upstream limit; the gateway does not tokenize locally. */
	maxTotalTokens?: number;
	documentsPerSearchUnit?: number;
}

export function textFromRerankDocument(document: RerankDocument): string {
	if (document.type !== "text")
		throw new TypeError(
			"The active rerank contract only supports text documents",
		);
	return document.text;
}
