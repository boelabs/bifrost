import type { ResolvedModelMetadata } from "#catalog/types.ts";
import { GatewayError } from "#core/errors.ts";

import type {
	CanonicalChatRequest,
	CanonicalContentPart,
} from "#core/canonical.ts";

function hasPart(
	req: CanonicalChatRequest,
	predicate: (part: CanonicalContentPart) => boolean,
): boolean {
	for (const message of req.messages) {
		if (!Array.isArray(message.content)) continue;
		if (message.content.some(predicate)) return true;
	}
	return false;
}

export function assertTextRequestSupported(
	req: CanonicalChatRequest,
	meta: ResolvedModelMetadata,
): void {
	if (req.tools && req.tools.length > 0 && !meta.capabilities.tools) {
		throw new GatewayError({
			class: "bad_request",
			deploymentHealth: "neutral",
			message: "The selected model does not support tools",
			code: "unsupported_model_capability",
			param: "tools",
		});
	}

	if (
		hasPart(req, (part) => part.type === "image") &&
		!meta.capabilities.vision
	) {
		throw new GatewayError({
			class: "bad_request",
			deploymentHealth: "neutral",
			message: "The selected model does not support vision inputs",
			code: "unsupported_model_capability",
			param: "messages",
		});
	}

	if (
		req.responseFormat?.type === "json_schema" &&
		!meta.capabilities.structuredOutputs
	) {
		throw new GatewayError({
			class: "bad_request",
			deploymentHealth: "neutral",
			message:
				"The selected model does not support JSON Schema structured outputs",
			code: "unsupported_model_capability",
			param: "response_format",
		});
	}

	// Reasoning policy is "clamp, don't reject": the only hard error is asking a NON-reasoner to actually
	// reason. Everything else is honored by snapping downstream (core/reasoning.snapEffort) to the levels
	// the model supports — an out-of-range effort moves into range, and "none" turns reasoning off when
	// the model has an off switch ("none" ∈ levels) or snaps to its floor (e.g. Gemini flash -> minimal)
	// when it does not. "none" on a non-reasoner is an allowed no-op (there is nothing to disable). This
	// keeps the gateway agnostic and forward-compatible: a new model just declares its `levels`.
	const requestedEffort = req.reasoning?.effort;
	const reasons = meta.capabilities.reasoning ? meta.reasoning : undefined;
	if (requestedEffort !== undefined && requestedEffort !== "none" && !reasons) {
		throw new GatewayError({
			class: "bad_request",
			deploymentHealth: "neutral",
			message: "The selected model does not support reasoning controls",
			code: "unsupported_model_capability",
			param: "reasoning",
		});
	}
}
