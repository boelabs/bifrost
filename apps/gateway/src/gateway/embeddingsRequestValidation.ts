import type { ResolvedModelMetadata } from "#catalog/types.ts";
import { embeddingProfileFor } from "#catalog/types.ts";
import { GatewayError } from "#core/errors.ts";

import type {
	CanonicalEmbeddingsRequest,
	EmbeddingInput,
} from "#core/embeddings.ts";

function unsupported(param: string, message: string): never {
	throw new GatewayError({
		class: "bad_request",
		message,
		code: "unsupported_parameter",
		param,
		publicMessage: message,
	});
}

function inputCount(input: EmbeddingInput): number {
	if (typeof input === "string") return 1;
	if (input.length === 0) return 0;
	const first = input[0];
	if (typeof first === "string" || Array.isArray(first)) return input.length;
	return 1;
}

function hasTokenInput(input: EmbeddingInput): boolean {
	if (typeof input === "string") return false;
	const first = input[0];
	return typeof first === "number" || Array.isArray(first);
}

const encoder = new TextEncoder();

function serializedInputBytes(input: unknown): number {
	return encoder.encode(
		typeof input === "string" ? input : JSON.stringify(input),
	).length;
}

function eachInput(input: EmbeddingInput): unknown[] {
	if (typeof input === "string") return [input];
	if (input.length === 0) return [];
	const first = input[0];
	if (typeof first === "string" || Array.isArray(first)) return input;
	return [input];
}

export function assertEmbeddingsRequestSupported(
	req: CanonicalEmbeddingsRequest,
	meta: ResolvedModelMetadata,
): void {
	const profile = embeddingProfileFor(meta);
	if (!profile)
		unsupported("model", "The selected model has no embeddings profile.");

	if (
		profile.encodingFormats &&
		!profile.encodingFormats.includes(req.encodingFormat)
	) {
		unsupported(
			"encoding_format",
			`The selected model does not support encoding_format=${req.encodingFormat}.`,
		);
	}

	if (req.dimensions !== undefined) {
		if (!profile.supportsDimensions) {
			unsupported(
				"dimensions",
				"The selected model does not support dimensions.",
			);
		}
		const min = profile.minDimensions ?? 1;
		const max = profile.maxDimensions ?? profile.dimensions;
		if (req.dimensions < min || (max !== undefined && req.dimensions > max)) {
			unsupported(
				"dimensions",
				max !== undefined
					? `The selected model supports dimensions between ${min} and ${max}.`
					: `The selected model supports dimensions >= ${min}.`,
			);
		}
	}

	if (
		profile.maxInputs !== undefined &&
		inputCount(req.input) > profile.maxInputs
	) {
		unsupported(
			"input",
			`The selected model accepts at most ${profile.maxInputs} inputs per request.`,
		);
	}
	if (profile.supportsTokenInput === false && hasTokenInput(req.input)) {
		unsupported(
			"input",
			"The selected model does not support pre-tokenized embedding inputs.",
		);
	}

	const inputs = eachInput(req.input);
	if (profile.maxInputBytes !== undefined) {
		for (const input of inputs) {
			if (serializedInputBytes(input) > profile.maxInputBytes) {
				unsupported(
					"input",
					`One embedding input exceeds the ${profile.maxInputBytes} byte model limit.`,
				);
			}
		}
	}
	if (
		profile.maxTotalInputBytes !== undefined &&
		serializedInputBytes(req.input) > profile.maxTotalInputBytes
	) {
		unsupported(
			"input",
			`Embedding inputs exceed the ${profile.maxTotalInputBytes} byte aggregate model limit.`,
		);
	}
}
