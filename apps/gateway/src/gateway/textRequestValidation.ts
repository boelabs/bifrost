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

export function requestUsesStrictTools(req: CanonicalChatRequest): boolean {
	return req.tools?.some((tool) => tool.strict === true) === true;
}

export function requestUsesStrictOutput(req: CanonicalChatRequest): boolean {
	return (
		req.responseFormat?.type === "json_schema" &&
		req.responseFormat.strict === true
	);
}

function explicitlyUnsupportedParameter(
	meta: ResolvedModelMetadata,
	name: string,
): boolean {
	const entry = meta.operations?.["text.generate"]?.parameters?.[name];
	if (entry === undefined || entry === true) return false;
	if (entry === false) return true;
	return entry.mode === "unsupported" || entry.mode === "ignored";
}

function assertStrictParameterIsNotDropped(
	req: CanonicalChatRequest,
	meta: ResolvedModelMetadata,
): void {
	const strictTools = requestUsesStrictTools(req);
	const strictOutput = requestUsesStrictOutput(req);
	const parameter = strictTools
		? [
				"tools",
				...(req.toolChoice !== undefined ? ["tool_choice"] : []),
				...(req.parallelToolCalls === true ? ["parallel_tool_calls"] : []),
			].find((name) => explicitlyUnsupportedParameter(meta, name))
		: strictOutput
			? explicitlyUnsupportedParameter(meta, "response_format")
				? "response_format"
				: explicitlyUnsupportedParameter(meta, "structured_outputs")
					? "structured_outputs"
					: undefined
			: undefined;
	if (parameter === undefined) return;
	throw new GatewayError({
		class: "bad_request",
		deploymentHealth: "neutral",
		message: `The selected model cannot preserve strict parameter "${parameter}"`,
		code: "unsupported_parameter",
		param: parameter,
	});
}

/** Strict guarantees are never eligible for unsupported-parameter dropping. */
export function assertStrictTextRequestSupported(
	req: CanonicalChatRequest,
	meta: ResolvedModelMetadata,
): void {
	if (requestUsesStrictTools(req) && meta.capabilities.strictTools !== true) {
		throw new GatewayError({
			class: "bad_request",
			deploymentHealth: "neutral",
			message: "The selected model does not support strict tool schemas",
			code: "unsupported_model_capability",
			param: "tools",
		});
	}

	if (requestUsesStrictOutput(req) && !meta.capabilities.structuredOutputs) {
		throw new GatewayError({
			class: "bad_request",
			deploymentHealth: "neutral",
			message: "The selected model does not support strict JSON Schema outputs",
			code: "unsupported_model_capability",
			param: "response_format",
		});
	}

	assertStrictParameterIsNotDropped(req, meta);
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

	assertStrictTextRequestSupported(req, meta);

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
