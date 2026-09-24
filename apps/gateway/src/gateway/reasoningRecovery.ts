import type { ResolvedModelMetadata } from "#catalog/types.ts";
import { GatewayError } from "#core/errors.ts";

import {
	toUpstreamReasoningEffort,
	type CanonicalReasoning,
	type ReasoningEffort,
	type ReasoningSpec,
	isReasoningEffort,
	resolveReasoning,
	EFFORT_ORDER,
} from "#core/reasoning.ts";

/** How many times one attempt may narrow its reasoning ladder after an upstream rejection. */
export const MAX_REASONING_RECOVERIES = 2;

export interface ReasoningRecovery {
	rejected: ReasoningEffort;
	spec: ReasoningSpec;
	effective: ReasoningEffort;
}

const QUOTED_TOKEN = /['"`]([A-Za-z_-]+)['"`]/g;
const REASONING_SUBJECT = /effort|thinking/i;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsToken(text: string, token: string): boolean {
	return new RegExp(
		`(^|[^A-Za-z0-9_])${escapeRegExp(token)}([^A-Za-z0-9_]|$)`,
		"i",
	).test(text);
}

function canonicalLabel(
	label: string,
	spec: ReasoningSpec,
): ReasoningEffort | undefined {
	const lower = label.toLowerCase();
	for (const [effort, upstream] of Object.entries(
		spec.upstreamEffortMap ?? {},
	)) {
		if (upstream.toLowerCase() === lower && isReasoningEffort(effort)) {
			return effort;
		}
	}
	return isReasoningEffort(lower) ? lower : undefined;
}

/**
 * Narrows a model's reasoning ladder after the upstream rejected the effort the gateway sent, so the
 * request can be re-snapped with the usual nearest-level rule whatever the catalog declared. The
 * ladder comes from the values the provider lists in its error; without a list, the rejected level is
 * dropped. Returns undefined unless the error is a 400 that names the effort actually sent and the
 * narrowed ladder resolves to a different one.
 */
export function recoverReasoning(
	error: unknown,
	reasoning: CanonicalReasoning | undefined,
	meta: ResolvedModelMetadata,
): ReasoningRecovery | undefined {
	const spec = meta.capabilities.reasoning ? meta.reasoning : undefined;
	if (
		!(spec && GatewayError.is(error)) ||
		error.provider?.status !== 400 ||
		spec.levels.length === 0
	) {
		return;
	}
	const rejected = resolveReasoning(reasoning, spec).effort;
	const listed = new Set<ReasoningEffort>();
	for (const match of error.message.matchAll(QUOTED_TOKEN)) {
		const effort = match[1] ? canonicalLabel(match[1], spec) : undefined;
		if (effort !== undefined && effort !== rejected) {
			listed.add(effort);
		}
	}
	// Either the error is about the effort field and names the value sent or the accepted ones
	// (Anthropic does not echo the input), or it quotes the value sent next to a list of efforts.
	const named = mentionsToken(
		error.message,
		toUpstreamReasoningEffort(rejected, spec),
	);
	const aboutEffort = REASONING_SUBJECT.test(
		`${error.message} ${error.param ?? ""}`,
	);
	if (!(aboutEffort ? named || listed.size > 0 : named && listed.size > 1)) {
		return;
	}

	const levels =
		listed.size > 0
			? EFFORT_ORDER.filter((effort) => listed.has(effort))
			: spec.levels.filter((effort) => effort !== rejected);
	if (levels.length === 0) {
		return;
	}
	const narrowed: ReasoningSpec = { ...spec, levels };
	const effective = resolveReasoning(reasoning, narrowed).effort;
	return effective === rejected
		? undefined
		: { rejected, spec: narrowed, effective };
}
