import { type GatewayRequest, gatewayJson } from "./gateway";
import { z } from "zod";

/**
 * Embeddings: text in, vectors out.
 *
 * A vector is not a thing to read, so the playground answers the two questions an operator actually
 * has — how long is it, and does this model place these texts where I expect — by reporting the
 * dimensions and the cosine similarity between every pair in the batch.
 */

export const ENCODING_FORMATS = ["float", "base64"] as const;

export interface EmbeddingSettings {
	dimensions?: number;
	encodingFormat?: string;
}

export const emptyEmbeddingSettings = (): EmbeddingSettings => ({});

export interface EmbeddingRun {
	id: string;
	inputs: string[];
	model: string;
	settings: EmbeddingSettings;
	state: "running" | "completed" | "failed" | "stopped";
	vectors: number[][];
	error?: string;
	durationMs?: number;
	promptTokens?: number;
	totalTokens?: number;
}

const embeddingsResponse = z.object({
	data: z.array(
		z.object({
			index: z.number().optional(),
			embedding: z.union([z.array(z.number()), z.string()]),
		}),
	),
	model: z.string().optional(),
	usage: z
		.object({
			prompt_tokens: z.number().optional(),
			total_tokens: z.number().optional(),
		})
		.optional(),
});

export type EmbeddingsResponse = z.infer<typeof embeddingsResponse>;

export function embeddingsBody(
	model: string,
	inputs: string[],
	settings: EmbeddingSettings,
): Record<string, unknown> {
	return {
		model,
		// A single text is sent as a string, as the contract's own example does; a batch as an array.
		input: inputs.length === 1 ? inputs[0] : inputs,
		...(settings.dimensions === undefined
			? {}
			: { dimensions: settings.dimensions }),
		...(settings.encodingFormat === undefined
			? {}
			: { encoding_format: settings.encodingFormat }),
	};
}

/**
 * Base64 embeddings are little-endian float32, which is what `encoding_format: "base64"` means and
 * what makes the answer a quarter of the size. Decoded here so the two formats are the same thing
 * on screen.
 */
export function decodeEmbedding(embedding: number[] | string): number[] {
	if (Array.isArray(embedding)) {
		return embedding;
	}
	const binary = atob(embedding);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return Array.from(new Float32Array(bytes.buffer));
}

/** In the order the gateway reported, not the order it answered in. */
export function vectorsFrom(response: EmbeddingsResponse): number[][] {
	return response.data
		.map((entry, position) => ({
			index: entry.index ?? position,
			vector: decodeEmbedding(entry.embedding),
		}))
		.sort((a, b) => a.index - b.index)
		.map((entry) => entry.vector);
}

export function cosineSimilarity(a: number[], b: number[]): number | undefined {
	if (a.length !== b.length || a.length === 0) {
		return undefined;
	}
	let dot = 0;
	let left = 0;
	let right = 0;
	for (let index = 0; index < a.length; index++) {
		const first = a[index] as number;
		const second = b[index] as number;
		dot += first * second;
		left += first * first;
		right += second * second;
	}
	const magnitude = Math.sqrt(left) * Math.sqrt(right);
	return magnitude === 0 ? undefined : dot / magnitude;
}

export async function runEmbeddings(
	input: { model: string; inputs: string[]; settings: EmbeddingSettings },
	options: GatewayRequest = {},
): Promise<EmbeddingsResponse> {
	return embeddingsResponse.parse(
		await gatewayJson<unknown>(
			"/embeddings",
			embeddingsBody(input.model, input.inputs, input.settings),
			options,
		),
	);
}
