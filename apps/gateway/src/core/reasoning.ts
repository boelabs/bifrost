/**
 * Normalized, provider-agnostic reasoning/thinking.
 *
 * The gateway exposes a single canonical "effort" knob (`ReasoningEffort`) in its public contracts.
 * Each model, via its catalog, declares HOW it controls reasoning (OpenAI-style effort, Anthropic
 * adaptive, Gemini level/budget...) and WHICH levels it supports. The requested effort is snapped to the
 * nearest available level; the target model's adapter translates it to its native shape.
 *
 * Dependency-free: core/canonical, db/schema, and the catalog import it without cycles.
 */

/** Canonical public vocabulary, ordered from disabled to the highest reasoning tier. */
export type ReasoningEffort =
	| "none"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export const EFFORT_ORDER: readonly ReasoningEffort[] = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return (
		typeof value === "string" &&
		(EFFORT_ORDER as readonly string[]).includes(value)
	);
}

function effortIndex(e: ReasoningEffort): number {
	const i = EFFORT_ORDER.indexOf(e);
	return i < 0 ? 0 : i;
}

/** Normalized reasoning that travels in the canonical request. */
export type ReasoningSummary = "auto" | "none" | "concise" | "detailed";

export interface CanonicalReasoning {
	effort?: ReasoningEffort;
	/**
	 * Visible-summary control. By gateway policy, if `effort` is on and no summary is specified, it is
	 * interpreted as "auto"; "none" is the explicit opt-out.
	 */
	summary?: ReasoningSummary;
	/** Visibility of the returned reasoning (when the model/contract allows it). */
	display?: "omitted" | "summarized";
}

export function summaryForEffort(
	effort: ReasoningEffort | undefined,
	summary: ReasoningSummary | undefined,
): ReasoningSummary | undefined {
	if (summary !== undefined) return summary;
	return effort !== undefined && effort !== "none" ? "auto" : undefined;
}

/** A model's capabilities (features), independent of the CallType. */
export interface TextCapabilities {
	tools: boolean;
	vision: boolean;
	reasoning: boolean;
	/** The model can adhere to a JSON Schema, not just produce valid JSON. */
	structuredOutputs: boolean;
}

/** The reasoning-control family of a specific model. */
export type ReasoningControlKind =
	| "openai_effort"
	/**
	 * OpenAI-compatible APIs that expose provider-specific reasoning controls in the request body,
	 * usually as `thinking: { type: "enabled" | "disabled" }`, optionally paired with a scalar
	 * effort field such as `reasoning_effort`.
	 */
	| "openai_body"
	| "anthropic_adaptive"
	| "anthropic_budget"
	| "gemini_level"
	| "gemini_budget"
	/**
	 * vLLM-style thinking toggle: injected as a flag inside `chat_template_kwargs` (e.g. kimi
	 * `{thinking:true}`, Qwen `{enable_thinking:true}`). Binary: the canonical effort only decides
	 * on/off; the parameter name and values are defined by `chatTemplateFlag`.
	 */
	| "chat_template_flag"
	/** Always-on reasoner with no upstream knob; the only valid public state is `high`. */
	| "fixed";

/** Config for the `chat_template_flag` kind: where and with what value to inject the toggle. */
interface ChatTemplateFlagConfig {
	/** Parameter name inside `chat_template_kwargs` (e.g. "thinking", "enable_thinking"). */
	param: string;
	/** Value when reasoning is active. Default `true`. */
	onValue?: boolean | string | number;
	/** Value when disabled. If omitted, the parameter is not emitted (the template default applies). */
	offValue?: boolean | string | number;
}

/** Config for the `openai_body` kind: the OpenAI-compatible top-level body field that controls thinking. */
interface BodyFieldReasoningConfig {
	/** Name of the top-level body field (e.g. "thinking"). */
	param: string;
	/** Value when reasoning is active. Default `true`. */
	onValue?: unknown;
	/** Value when disabled. If omitted, the parameter is not emitted. */
	offValue?: unknown;
}

/**
 * How a model controls reasoning. `levels` = the effort levels it accepts, as points on the canonical
 * ladder `none < minimal < low < medium < high < xhigh < max` (any order; sorted when snapping). Whether the
 * model can be turned OFF is encoded directly in the ladder: `"none" ∈ levels` means a literal off
 * switch exists; if `"none"` is absent the model always reasons and a request for "none" snaps up to
 * its lowest level (its "floor"). `budgets` only for the *_budget kinds (tokens per level).
 *
 * Convention for binary controls:
 *  - on/off toggle: `levels: ["none", "high"]` -> public API `none | high`.
 *  - fixed reasoner: `kind: "fixed"`, `levels: ["high"]` -> always reasons, only `high`.
 * `fixed` never emits an upstream parameter: it describes a behavior, not a provider control.
 *
 * `upstreamEffortMap` separates our contract from synonymous native vocabulary. Its keys are ALWAYS
 * the gateway's canonical efforts and its values are the provider's labels. It must not collapse
 * semantically distinct tiers (in particular, `xhigh` and `max` remain distinct). If there is no entry,
 * the same canonical name is emitted. Non-scalar shapes (`true`,
 * `{type:"enabled"}`, budgets, etc.) remain the responsibility of the adapter indicated by `kind`.
 */
export interface ReasoningSpec {
	kind: ReasoningControlKind;
	levels: ReasoningEffort[];
	budgets?: Partial<Record<ReasoningEffort, number>>;
	upstreamEffortMap?: Partial<Record<ReasoningEffort, string>>;
	/** Only for `kind: "openai_body"`: top-level field that enables/disables thinking. */
	bodyField?: BodyFieldReasoningConfig;
	/** Only for `kind: "openai_body"`: optional top-level field that receives the upstream effort. */
	effortField?: string;
	/** Only for `kind: "chat_template_flag"`: configures the chat_template_kwargs flag. */
	chatTemplateFlag?: ChatTemplateFlagConfig;
}

/** Translates a resolved canonical effort to the scalar label the upstream understands. */
export function toUpstreamReasoningEffort(
	effort: ReasoningEffort,
	spec: ReasoningSpec,
): string {
	return spec.upstreamEffortMap?.[effort] ?? effort;
}

/**
 * Snaps the requested effort to the nearest level the model supports. Two rules, with "none" (OFF)
 * treated as special because it is a state, not a degree of reasoning:
 *  - request "none": returns "none" if the model has an off switch (`"none" ∈ levels`); otherwise the
 *    model always reasons, so it snaps UP to the lowest available level (its "floor").
 *  - request of a real effort (minimal..max): chosen among the POSITIVE levels only — the highest one
 *    that does not exceed the request, or the floor if the request is below all of them. A positive
 *    request NEVER rounds DOWN into "none": asking for some reasoning never turns it off.
 * This makes `levels` the single source of truth for "can this model disable reasoning, and what does
 * it fall back to" — no separate flag. Returns a level guaranteed ∈ `levels`. Handles non-contiguous
 * support (e.g. low/high/max, without medium or xhigh) by choosing the nearest one downward.
 */
export function snapEffort(
	requested: ReasoningEffort,
	spec: ReasoningSpec,
): ReasoningEffort {
	const sorted = [...spec.levels].sort(
		(a, b) => effortIndex(a) - effortIndex(b),
	);
	if (sorted.length === 0) return requested;
	// Explicit OFF, honored only if the model actually exposes it (lowest rung is "none").
	if (requested === "none" && sorted[0] === "none") return "none";

	// Positive request (or "none" on a mandatory reasoner): pick among the reasoning levels, never "none".
	const positives = sorted.filter((lvl) => lvl !== "none");
	if (positives.length === 0) return "none"; // degenerate: the model only declares "none"

	const reqIdx = effortIndex(requested);
	let chosen = positives[0]!; // floor if the request is below all of them
	for (const lvl of positives) {
		if (effortIndex(lvl) <= reqIdx) chosen = lvl;
		else break;
	}
	return chosen;
}

/** Does the resolved summary imply emitting/showing the thoughts? */
export function summaryVisible(summary: ReasoningSummary | undefined): boolean {
	return summary !== undefined && summary !== "none";
}

/** Effective reasoning resolved against a model's spec. */
export interface ResolvedReasoning {
	/** Effective effort, guaranteed ∈ spec.levels (or "none"). */
	effort: ReasoningEffort;
	/** Resolved visible summary (the client's, or "auto" if there is reasoning); undefined if N/A. */
	summary: ReasoningSummary | undefined;
}

/**
 * Resolves the effective reasoning of a request for a model with a given spec. PROVIDER-AGNOSTIC: it
 * only depends on the spec. Gateway policy when the client OMITS the effort: it is treated as if the
 * MINIMUM was requested, i.e. `snapEffort("none", spec)`:
 *  - Model with a literal off (`"none" ∈ levels`) -> "none" (does not reason by default).
 *  - Model that ALWAYS reasons (`"none" ∉ levels`) -> its lowest level (minimal/low), with thoughts.
 * No opaque upstream default is inherited. An explicit effort is snapped to what is supported.
 */
export function resolveReasoning(
	reasoning: CanonicalReasoning | undefined,
	spec: ReasoningSpec,
): ResolvedReasoning {
	const effort = snapEffort(reasoning?.effort ?? "none", spec);
	const summary =
		effort === "none"
			? undefined
			: summaryForEffort(effort, reasoning?.summary);
	return { effort, summary };
}

/**
 * Resolves the `chat_template_kwargs` flag for a model with `kind: "chat_template_flag"`.
 * The canonical effort only decides on/off (snapped against the spec): active -> `onValue` (default
 * `true`), inactive -> `offValue` (if omitted, the parameter is not emitted). Returns `undefined` when
 * it does not apply (another kind, no config, or disabled without `offValue`).
 */
export function resolveChatTemplateFlag(
	reasoning: CanonicalReasoning | undefined,
	spec: ReasoningSpec,
): { param: string; value: boolean | string | number } | undefined {
	const cfg = spec.chatTemplateFlag;
	if (spec.kind !== "chat_template_flag" || !cfg) return undefined;
	const on = resolveReasoning(reasoning, spec).effort !== "none";
	const value = on ? (cfg.onValue ?? true) : cfg.offValue;
	if (value === undefined) return undefined;
	return { param: cfg.param, value };
}

/**
 * Resolves the top-level reasoning field for OpenAI-compatible APIs with native controls outside
 * `reasoning_effort`, for example `thinking: { type: "enabled" | "disabled" }`.
 */
export function resolveBodyFieldReasoning(
	reasoning: CanonicalReasoning | undefined,
	spec: ReasoningSpec,
): { param: string; value: unknown } | undefined {
	const cfg = spec.bodyField;
	if (spec.kind !== "openai_body" || !cfg) return undefined;
	const on = resolveReasoning(reasoning, spec).effort !== "none";
	const value = on ? (cfg.onValue ?? true) : cfg.offValue;
	if (value === undefined) return undefined;
	return { param: cfg.param, value };
}

/** Operation observability: what the client asked for vs what actually ran after snapping. */
export interface ReasoningLogInfo {
	/** Effort the client explicitly requested. */
	requested: ReasoningEffort | null;
	/** Effort actually applied after snapping to the model's levels. */
	effective: ReasoningEffort;
	/** True when the request was adjusted (out of range, or "none" on a mandatory reasoner). */
	clamped: boolean;
	/** Why the effective value was selected. */
	source: "client" | "model_floor" | "clamped";
}

/**
 * Builds the reasoning entry for operation metadata. Because the gateway clamps instead of rejecting, the
 * effective effort can differ from what the client asked for (e.g. "none" -> "minimal" on a Gemini
 * flash, or "max" -> "xhigh"); surfacing both makes that adjustment observable (no surprise costs).
 * An omitted effort is still reported for reasoning models because their model floor is an effective
 * runtime decision with latency and cost implications. Returns undefined only for non-reasoning models.
 */
export function reasoningLogInfo(
	reasoning: CanonicalReasoning | undefined,
	spec: ReasoningSpec | undefined,
): ReasoningLogInfo | undefined {
	if (!spec) return undefined;
	const requested = reasoning?.effort ?? null;
	const effective = resolveReasoning(reasoning, spec).effort;
	const clamped = requested !== null && requested !== effective;
	return {
		requested,
		effective,
		clamped,
		source: requested === null ? "model_floor" : clamped ? "clamped" : "client",
	};
}

/**
 * Conservative bucketing for contracts that express thinking as a token budget. `max` is never
 * inferred from a generic token count: providers define it as a behavioral tier, not a portable token
 * threshold, so only an explicit effort request can select it.
 */
export function effortFromBudgetTokens(tokens: number): ReasoningEffort {
	if (tokens <= 0) return "none";
	if (tokens <= 512) return "minimal";
	if (tokens <= 4_096) return "low";
	if (tokens <= 12_000) return "medium";
	if (tokens <= 20_000) return "high";
	return "xhigh";
}
