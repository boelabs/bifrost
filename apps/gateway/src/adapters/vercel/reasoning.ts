import type { CanonicalChatRequest } from "#core/canonical.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { GatewayError } from "#core/errors.ts";

import {
	toUpstreamReasoningEffort,
	type ReasoningSpec,
	resolveReasoning,
	summaryVisible,
} from "#core/reasoning.ts";

function recordValue(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Vercel's OpenAI-shaped REST surfaces expose one normalized reasoning object regardless of the
 * selected model creator. This transport view is intentionally adapter-local: catalog metadata keeps
 * the model's real control family, while the shared OpenAI builders receive only the normalized
 * vocabulary they need to serialize a base request.
 */
export function vercelRestReasoningSpec(
	spec: ReasoningSpec | undefined,
): ReasoningSpec | undefined {
	return spec === undefined
		? undefined
		: { kind: "openai_effort", levels: [...spec.levels] };
}

function mergeGeneratedProviderOptions(
	body: Record<string, unknown>,
	generated: Record<string, unknown>,
): void {
	const existingValue = body.providerOptions;
	if (existingValue !== undefined && recordValue(existingValue) === undefined) {
		throw new GatewayError({
			class: "bad_request",
			message: "extra_body.providerOptions must be an object",
			code: "invalid_extra_body",
			param: "extra_body.providerOptions",
		});
	}
	const target = structuredClone(recordValue(existingValue) ?? {});

	const merge = (
		into: Record<string, unknown>,
		source: Record<string, unknown>,
		path: string,
	): void => {
		for (const [key, value] of Object.entries(source)) {
			const currentPath = path ? `${path}.${key}` : key;
			const existing = into[key];
			if (existing === undefined) {
				into[key] = structuredClone(value);
				continue;
			}
			const existingRecord = recordValue(existing);
			const valueRecord = recordValue(value);
			if (existingRecord !== undefined && valueRecord !== undefined) {
				merge(existingRecord, valueRecord, currentPath);
				continue;
			}
			throw new GatewayError({
				class: "bad_request",
				message: `extra_body.providerOptions.${currentPath} collides with adapter-managed reasoning`,
				code: "invalid_extra_body",
				param: `extra_body.providerOptions.${currentPath}`,
			});
		}
	};

	merge(target, generated, "");
	body.providerOptions = target;
}

function reasoningDisplay(
	req: CanonicalChatRequest,
	summary: ReturnType<typeof resolveReasoning>["summary"],
): "omitted" | "summarized" {
	if (req.reasoning?.display !== undefined) return req.reasoning.display;
	return summaryVisible(summary) ? "summarized" : "omitted";
}

function requiredBudget(spec: ReasoningSpec, effort: string): number {
	const budget = spec.budgets?.[effort as keyof typeof spec.budgets];
	if (budget !== undefined) return budget;
	throw new GatewayError({
		class: "server",
		message: `Vercel reasoning metadata has no token budget for effort "${effort}"`,
		code: "invalid_provider_response",
	});
}

/**
 * Replaces Vercel's generic REST reasoning object with creator/provider options when that is the
 * documented lossless path. Multiple namespaces are emitted for models that Vercel may route through
 * more than one execution provider; only the provider handling the request consumes its entry.
 */
export function applyVercelNativeReasoning(
	body: Record<string, unknown>,
	req: CanonicalChatRequest,
	ctx: AdapterContext,
): void {
	const spec = ctx.meta.reasoning;
	if (spec === undefined) return;
	const resolved = resolveReasoning(req.reasoning, spec);
	const effort = resolved.effort;
	const display = reasoningDisplay(req, resolved.summary);
	const includeThoughts = display === "summarized";

	switch (spec.kind) {
		case "openai_effort":
		case "openai_body":
		case "chat_template_flag":
			// Vercel's normalized REST field is the documented cross-provider control for these
			// scalar/toggle families. In particular, GPT-5.6 `max` stays `max`.
			return;

		case "fixed":
			delete body.reasoning;
			delete body.reasoning_effort;
			return;

		case "anthropic_adaptive": {
			delete body.reasoning;
			delete body.reasoning_effort;
			if (effort === "none") {
				mergeGeneratedProviderOptions(body, {
					anthropic: { thinking: { type: "disabled" } },
					bedrock: { reasoningConfig: { type: "disabled" } },
				});
				return;
			}
			const nativeEffort = toUpstreamReasoningEffort(effort, spec);
			mergeGeneratedProviderOptions(body, {
				anthropic: {
					thinking: { type: "adaptive", display },
					effort: nativeEffort,
				},
				bedrock: {
					reasoningConfig: {
						type: "adaptive",
						maxReasoningEffort: nativeEffort,
						display,
					},
				},
			});
			return;
		}

		case "anthropic_budget": {
			delete body.reasoning;
			delete body.reasoning_effort;
			if (effort === "none") {
				mergeGeneratedProviderOptions(body, {
					anthropic: { thinking: { type: "disabled" } },
					bedrock: { reasoningConfig: { type: "disabled" } },
				});
				return;
			}
			const budgetTokens = requiredBudget(spec, effort);
			mergeGeneratedProviderOptions(body, {
				anthropic: {
					thinking: { type: "enabled", budgetTokens },
				},
				bedrock: {
					reasoningConfig: { type: "enabled", budgetTokens },
				},
			});
			return;
		}

		case "gemini_level": {
			delete body.reasoning;
			delete body.reasoning_effort;
			const thinkingLevel = toUpstreamReasoningEffort(effort, spec);
			const thinkingConfig = { thinkingLevel, includeThoughts };
			mergeGeneratedProviderOptions(body, {
				google: { thinkingConfig },
				vertex: { thinkingConfig },
			});
			return;
		}

		case "gemini_budget": {
			delete body.reasoning;
			delete body.reasoning_effort;
			const thinkingBudget =
				effort === "none" ? 0 : requiredBudget(spec, effort);
			const thinkingConfig = { thinkingBudget, includeThoughts };
			mergeGeneratedProviderOptions(body, {
				google: { thinkingConfig },
				vertex: { thinkingConfig },
			});
			return;
		}
	}
}
