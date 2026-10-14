import type { CallType } from "#core/callType.ts";
import type { CooldownCause } from "./state.ts";
import { GatewayError } from "#core/errors.ts";

/**
 * What the caller is told when no deployment could serve the request.
 *
 * The caller sees what a provider would have said: the status and public message of the last
 * upstream answer, or a plain unavailability when no upstream was reached. How the router got
 * there - the reason, the attempts, the causes of a cooldown - is gateway detail and goes to the
 * internal message the operation log keeps, never to the response.
 */

export type FailReason =
	| "no_candidates"
	| "cooldown"
	| "rate_limited"
	| "attempt_limit"
	| "deadline"
	| "exhausted";

const attemptsLabel = (n: number): string =>
	`${n} attempt${n === 1 ? "" : "s"}`;

/** The classes a cooldown can be made of without any prospect of clearing on its own. */
const CONFIGURATION_CLASSES = new Set<string>([
	"auth",
	"permission",
	"not_found",
]);

function retryAfterHeader(
	retryAfterMs: number | undefined,
): { headers: Record<string, string> } | Record<string, never> {
	return retryAfterMs === undefined
		? {}
		: {
				headers: {
					"Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
				},
			};
}

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
	// The raw answer of the last upstream contacted stays on the error for the logs.
	const provider =
		p.lastError?.provider === undefined
			? {}
			: { provider: p.lastError.provider };
	const cooldownProvider =
		p.cooldownCauses.size > 0
			? {
					provider: {
						body: { cooldown_causes: Object.fromEntries(p.cooldownCauses) },
					},
				}
			: provider;

	if (p.reason === "cooldown") {
		const causes = [...p.cooldownCauses.values()];
		const misconfigured =
			causes.length > 0 &&
			causes.every((item) => CONFIGURATION_CLASSES.has(item.class));
		// Credentials and model ids do not fix themselves, so a pool held down by them must not
		// invite a retry. It is still the operator's problem, never the caller's credentials: 503.
		return new GatewayError({
			class: "server",
			status: 503,
			message: internal,
			publicMessage: `The model \`${p.publicModel}\` is currently unavailable.`,
			code: misconfigured ? "model_unavailable" : "model_overloaded",
			...(misconfigured ? {} : retryAfterHeader(p.retryAfterMs)),
			...cooldownProvider,
		});
	}
	if (p.reason === "rate_limited") {
		return new GatewayError({
			class: "rate_limit",
			message: internal,
			publicMessage: `Rate limit reached for model \`${p.publicModel}\`. Please try again later.`,
			code: "rate_limit_exceeded",
			...retryAfterHeader(p.retryAfterMs),
			...provider,
		});
	}
	if (!p.lastError) {
		return new GatewayError({
			class: "server",
			status: 503,
			message: internal,
			publicMessage: `The model \`${p.publicModel}\` is currently unavailable.`,
			code: "model_unavailable",
		});
	}
	// Whatever ended the request, the caller hears the last upstream answer, as the provider gave it.
	const last = p.lastError;
	return new GatewayError({
		class: last.class,
		publicClass: last.publicClass,
		message: internal,
		publicMessage: last.publicMessage,
		status: last.httpStatus,
		code: last.code,
		param: last.param,
		...(last.headers ? { headers: last.headers } : {}),
		...(last.retryAfterMs === undefined
			? {}
			: { retryAfterMs: last.retryAfterMs }),
		...provider,
	});
}
