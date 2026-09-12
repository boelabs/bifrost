import type { components } from "#/shared/api/schema";

/**
 * The router vocabulary: the settings types, the strategy and reason enumerations, and the field
 * descriptions the form is generated from.
 *
 * `api.ts` reads cookies through `next/headers`, so the form and the fallback dialog — both Client
 * Components — cannot import it. Everything they need that is not a network call lives here.
 */
export type RouterSettings = components["schemas"]["RouterSettingsState"];
export type RouterSettingsPatch = components["schemas"]["RouterSettings"];
export type FallbackPolicy = components["schemas"]["FallbackPolicy"];

export const ROUTING_STRATEGIES = [
	"simple-shuffle",
	"least-busy",
	"usage-based-tpm",
	"usage-based-rpm",
	"latency-based",
	"throughput-based",
	"price-based",
	"health-aware",
] as const;

/**
 * How the gateway treats a parameter the target model declares unsupported. It matters in the
 * playground: under `error`, sending one that a model does not support fails the whole request.
 */
export const PARAMETER_STRATEGIES = ["drop", "error", "allow"] as const;

export const FALLBACK_REASONS = [
	"general",
	"context_window",
	"content_policy",
] as const;

/**
 * A chain is stored as (primaryModel, reason), but "reason" is a column name, not a question an
 * operator can answer. Asking someone to pick `content_policy` from a dropdown makes them reverse
 * engineer what the gateway does with it; three named lists say it outright, and each one carries
 * the sentence that explains when it fires.
 */
export const FALLBACK_KINDS: readonly {
	reason: (typeof FALLBACK_REASONS)[number];
	title: string;
	description: string;
	empty: string;
}[] = [
	{
		reason: "general",
		title: "When the pool fails",
		description:
			"Used when every deployment of the primary model failed for ordinary reasons — upstream errors, timeouts, exhausted retries.",
		empty:
			"Without this, a failing pool returns the error to the caller instead of trying another model.",
	},
	{
		reason: "context_window",
		title: "When the prompt is too long",
		description:
			"Used only when the pool rejected the request for exceeding the model's context window. Send it to a model with more room.",
		empty:
			"Without this, an over-long prompt fails instead of moving to a larger model.",
	},
	{
		reason: "content_policy",
		title: "When the content filter blocks it",
		description:
			"Used only when the pool refused the request on content policy grounds. Send it to a model with different moderation.",
		empty:
			"Without this, a blocked request fails instead of trying a differently moderated model.",
	},
];

/** Error classes that can carry their own failure budget. */
export const ERROR_CLASSES = [
	"timeout",
	"server",
	"rate_limit",
	"auth",
	"not_found",
	"permission",
	"content_policy",
	"context_window",
	"bad_request",
] as const;

export type RouterGroup = "opening" | "cooldown" | "deadlines";

/**
 * The router's scalar knobs, grouped the way an operator reasons about them rather than the way the
 * table stores them: what opens a circuit, how long it stays open, and how long an attempt is given
 * before it is abandoned. Fifteen numbers in one grid is a wall; three named groups is a decision.
 *
 * `executionPolicies` is deliberately absent — it is a nested per-operation structure with ordering
 * constraints between its deadlines, and it belongs in its own editor rather than smuggled in here.
 */
export const ROUTER_NUMERIC_FIELDS: readonly {
	key: keyof Pick<
		RouterSettings,
		| "allowedFails"
		| "minWindowRequests"
		| "failureWindowSeconds"
		| "cooldownSeconds"
		| "maxCooldownSeconds"
		| "halfOpenProbeSeconds"
		| "configurationCooldownSeconds"
		| "throttleCooldownSeconds"
		| "retryAfterSeconds"
		| "adaptiveTimeoutMultiplier"
		| "adaptiveTimeoutFloorMs"
	>;
	group: RouterGroup;
	label: string;
	hint: string;
	min: number;
	step?: number;
	unit: string | null;
}[] = [
	{
		key: "allowedFails",
		group: "opening",
		label: "Allowed fails",
		hint: "Absolute ceiling: this many failures open the circuit no matter how much traffic succeeded. It is the backstop for a deployment failing outright, not the main rule.",
		min: 0,
		unit: null,
	},
	{
		key: "minWindowRequests",
		group: "opening",
		label: "Minimum attempts",
		hint: "Attempts the window needs before the failure rate is allowed to decide anything. Below this, three failures after a quiet hour read as 100%.",
		min: 1,
		unit: null,
	},
	{
		key: "failureWindowSeconds",
		group: "opening",
		label: "Failure window",
		hint: "How long failures and attempts are counted for.",
		min: 1,
		unit: "s",
	},
	{
		key: "cooldownSeconds",
		group: "cooldown",
		label: "Cooldown",
		hint: "How long a deployment stays out after its circuit opens. Zero disables automatic cooldown entirely.",
		min: 0,
		unit: "s",
	},
	{
		key: "maxCooldownSeconds",
		group: "cooldown",
		label: "Max cooldown",
		hint: "Ceiling for the escalating cooldown.",
		min: 1,
		unit: "s",
	},
	{
		key: "halfOpenProbeSeconds",
		group: "cooldown",
		label: "Half-open probe",
		hint: "How long one probe request may hold the recovery slot before another may try.",
		min: 1,
		unit: "s",
	},
	{
		key: "configurationCooldownSeconds",
		group: "cooldown",
		label: "Configuration cooldown",
		hint: "Applied when the failure looks like misconfiguration (401, 403, 404) rather than load.",
		min: 1,
		unit: "s",
	},
	{
		key: "throttleCooldownSeconds",
		group: "cooldown",
		label: "Throttle cooldown",
		hint: "Applied when the provider answers 429. Shared by every deployment in the same failure domain.",
		min: 1,
		unit: "s",
	},
	{
		key: "retryAfterSeconds",
		group: "cooldown",
		label: "Retry after",
		hint: "Floor before a transient retry; exponential full jitter is added on top.",
		min: 0,
		unit: "s",
	},
	{
		key: "adaptiveTimeoutMultiplier",
		group: "deadlines",
		label: "Deadline multiplier",
		hint: "How many times its own typical first-output time a deployment is granted before the attempt is abandoned.",
		min: 1,
		step: 0.5,
		unit: "×",
	},
	{
		key: "adaptiveTimeoutFloorMs",
		group: "deadlines",
		label: "Deadline floor",
		hint: "The adaptive deadline never goes below this, so ordinary variance cannot cut off a fast deployment.",
		min: 1,
		unit: "ms",
	},
];

export type RouterNumericKey = (typeof ROUTER_NUMERIC_FIELDS)[number]["key"];

export const ROUTER_GROUPS: readonly {
	id: RouterGroup;
	title: string;
	description: string;
}[] = [
	{
		id: "opening",
		title: "When a deployment is taken out",
		description:
			"A deployment is quarantined on its failure RATE, not on a raw count — an absolute threshold punishes a busy deployment for the same error rate a quiet one survives.",
	},
	{
		id: "cooldown",
		title: "How long it stays out",
		description:
			"The cooldown escalates on each failed recovery probe, up to the ceiling. A successful probe clears it immediately.",
	},
	{
		id: "deadlines",
		title: "How long an attempt is given",
		description:
			"A pool-wide deadline has to accommodate its slowest member, so a fast deployment inherits a budget it never needs — and a stuck request waits it out before failing over.",
	},
];

export type DashboardSettings = components["schemas"]["DashboardSettingsState"];
export type DashboardSettingsPatch = components["schemas"]["DashboardSettings"];
