import type { CanonicalChatRequest } from "#core/canonical.ts";
import type { AdapterContext } from "./types.ts";
import { GatewayError } from "#core/errors.ts";

import {
	type ReasoningControlKind,
	type ResolvedReasoning,
	resolveReasoning,
} from "#core/reasoning.ts";

/**
 * Resolves the effective reasoning (effort + summary) for the target model's adapter.
 * Returns `undefined` ONLY when the model does not reason (no spec) and the client did not request a
 * real effort: in that case no thinking config is emitted. If the model reasons, an effort is ALWAYS
 * resolved (the lowest supported one if the client omitted it), so we receive thoughts by default.
 */
export function resolveAdapterReasoning(
	req: CanonicalChatRequest,
	ctx: AdapterContext,
	allowedKinds: readonly ReasoningControlKind[],
): ResolvedReasoning | undefined {
	const spec = ctx.meta.reasoning;
	if (!spec) {
		const effort = req.reasoning?.effort;
		if (effort === undefined || effort === "none") return undefined;
		throw new GatewayError({
			class: "bad_request",
			message: "The selected model does not support reasoning controls",
			code: "unsupported_model_capability",
			param: "reasoning",
		});
	}
	if (!allowedKinds.includes(spec.kind)) {
		throw new GatewayError({
			class: "bad_request",
			message: `Reasoning control "${spec.kind}" is not compatible with this adapter`,
			code: "unsupported_model_capability",
			param: "reasoning",
		});
	}
	return resolveReasoning(req.reasoning, spec);
}
