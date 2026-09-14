import { type ErrorClass, GatewayError } from "#core/errors.ts";
import type { CallType } from "#core/callType.ts";
import type { CooldownCause } from "./state.ts";

/**
 * What the caller is told when no deployment could serve the request.
 *
 * Its own module because it is the gateway's whole public account of a routing failure and nothing
 * else in the router depends on it — and because the difference between "retry shortly" and "this
 * will never work" is the difference between an operator waiting and an operator fixing something.
 */

export type FailReason =
	| "no_candidates"
	| "cooldown"
	| "rate_limited"
	| "attempt_budget"
	| "exhausted";

const attemptsLabel = (n: number): string =>
	`${n} attempt${n === 1 ? "" : "s"}`;

/** Readable phrase for the underlying cause (class of the last error), gateway info. */
function causePhrase(cls: GatewayError["class"] | undefined): string {
	switch (cls) {
		case "timeout":
			return "upstream timeouts";
		case "rate_limit":
			return "upstream rate limiting";
		case "context_window":
			return "context window exceeded";
		case "content_policy":
			return "content policy blocks";
		case "auth":
			return "upstream authentication errors";
		default:
			return "upstream errors";
	}
}

/**
 * The classes `defaultFailureKind` treats as configuration, and therefore the ones a cooldown can be
 * made of without any prospect of clearing on its own.
 */
const CONFIGURATION_CLASSES = new Set<string>([
	"auth",
	"permission",
	"not_found",
]);

export function buildRoutingError(p: {
	publicModel: string;
	callType: CallType;
	attempts: number;
	reason: FailReason;
	triedFallback: boolean;
	retryAfterMs: number | undefined;
	lastError: GatewayError | undefined;
	cooldownCauses: Map<string, CooldownCause>;
}): GatewayError {
	const fbNote = p.triedFallback ? " (including fallbacks)" : "";
	const internal =
		`Routing failed for public model "${p.publicModel}" (${p.callType})${fbNote} after ${attemptsLabel(p.attempts)}; ` +
		`reason=${p.reason}; lastError=${p.lastError?.message ?? "n/a"}`;
	// Preserve the RAW response of the last upstream contacted (status + body) in the routing error,
	// so error.provider.body in the logs has the real detail and not just the gateway summary. If no
	// upstream was contacted (e.g. pure cooldown, 0 attempts), lastError is undefined and there is no
	// provider to attach.
	const provider =
		p.lastError?.provider !== undefined
			? { provider: p.lastError.provider }
			: {};

	if (p.reason === "cooldown") {
		/**
		 * A pool held down entirely by misconfiguration is not "temporarily unavailable": credentials
		 * and model ids do not fix themselves, so inviting a retry is the one answer guaranteed to be
		 * wrong. Answer with what the deployments actually said, which is something an operator can
		 * act on. Mixed causes stay a 503 — anything transient in there really may clear.
		 */
		const causes = [...p.cooldownCauses.values()];
		const configuration =
			causes.length > 0 &&
			causes.every((cause) => CONFIGURATION_CLASSES.has(cause.class));
		if (configuration) {
			const [first] = causes;
			const cls = (first?.class ?? "not_found") as ErrorClass;
			return new GatewayError({
				class: cls,
				message: internal,
				publicMessage: `No deployment for public model "${p.publicModel}" is usable${fbNote}: every one of them is misconfigured.`,
				code: "deployments_misconfigured",
				provider: {
					body: { cooldown_causes: Object.fromEntries(p.cooldownCauses) },
				},
			});
		}
		// Saved causes (errors that triggered cooldown) -> provider detail for logs.
		const causeProvider =
			p.cooldownCauses.size > 0
				? {
						provider: {
							body: { cooldown_causes: Object.fromEntries(p.cooldownCauses) },
						},
					}
				: provider;
		return new GatewayError({
			class: "server",
			status: 503,
			message: internal,
			publicMessage: `All deployments for public model "${p.publicModel}" are temporarily unavailable${fbNote}. Please retry shortly.`,
			code: "deployments_in_cooldown",
			...(p.retryAfterMs !== undefined
				? {
						headers: {
							"Retry-After": String(
								Math.max(1, Math.ceil(p.retryAfterMs / 1000)),
							),
						},
					}
				: {}),
			...causeProvider,
		});
	}
	if (p.reason === "rate_limited") {
		return new GatewayError({
			class: "rate_limit",
			message: internal,
			publicMessage: `All deployments for public model "${p.publicModel}" are temporarily rate limited${fbNote}, either by configured RPM/TPM limits or by upstream capacity. Please try again later.`,
			code: "rate_limit_exceeded",
			...(p.retryAfterMs !== undefined
				? {
						headers: {
							"Retry-After": String(
								Math.max(1, Math.ceil(p.retryAfterMs / 1000)),
							),
						},
					}
				: {}),
			...provider,
		});
	}
	// exhausted / no_candidates: there were failed attempts (or no eligible deployment).
	const cls = p.lastError?.class ?? "server";
	const cause = p.lastError ? ` (cause: ${causePhrase(cls)})` : "";
	return new GatewayError({
		class: cls,
		message: internal,
		publicMessage: `No deployments for public model "${p.publicModel}" were able to handle the request${fbNote} after ${attemptsLabel(p.attempts)}${cause}. Please try again later.`,
		code: "no_deployments_available",
		...(p.lastError?.httpStatus ? { status: p.lastError.httpStatus } : {}),
		...(p.lastError?.headers ? { headers: p.lastError.headers } : {}),
		...(p.lastError?.retryAfterMs !== undefined
			? { retryAfterMs: p.lastError.retryAfterMs }
			: {}),
		...provider,
	});
}
