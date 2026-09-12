import { GatewayError } from "#core/errors.ts";

export interface GatewayAbortReason {
	owner: "client" | "gateway";
	type:
		| "cancelled"
		| "timeout"
		| "settled"
		| "shutdown"
		| "downstream_backpressure";
	phase?: string;
}

function typedReason(signal: AbortSignal): GatewayAbortReason | null {
	const reason = signal.reason;
	if (reason === null || typeof reason !== "object") return null;
	const candidate = reason as Partial<GatewayAbortReason>;
	if (candidate.owner !== "client" && candidate.owner !== "gateway")
		return null;
	if (
		candidate.type !== "cancelled" &&
		candidate.type !== "timeout" &&
		candidate.type !== "settled" &&
		candidate.type !== "shutdown" &&
		candidate.type !== "downstream_backpressure"
	)
		return null;
	return candidate as GatewayAbortReason;
}

/** An untyped aborted signal is conservatively treated as a client disconnect. */
export function isClientAbortSignal(signal: AbortSignal): boolean {
	if (!signal.aborted) return false;
	const reason = typedReason(signal);
	return reason === null || reason.owner === "client";
}

export function abortGatewayError(
	signal: AbortSignal,
	fallbackPhase = "streaming",
): GatewayError {
	const reason = typedReason(signal);
	if (reason?.owner === "client" || reason?.type === "cancelled")
		return new GatewayError({
			class: "bad_request",
			status: 499,
			code: "client_closed_request",
			message: "Client closed the request before completion",
			failureKind: "request",
			deploymentHealth: "neutral",
			routingScope: "request",
			retryable: false,
		});
	if (reason?.type === "downstream_backpressure")
		return new GatewayError({
			class: "server",
			code: "downstream_backpressure",
			message: "Downstream client write exceeded its deadline",
			failureKind: "gateway",
			deploymentHealth: "neutral",
			routingScope: "request",
			retryable: false,
		});
	const phase = reason?.phase ?? fallbackPhase;
	if (reason?.type === "settled")
		return new GatewayError({
			class: "server",
			code: "upstream_cancelled_after_settlement",
			message: "Upstream transport was cancelled after settlement",
			failureKind: "gateway",
			deploymentHealth: "neutral",
			retryable: false,
		});
	return new GatewayError({
		class: "timeout",
		code: `upstream_${phase}_timeout`,
		message: `Upstream execution exceeded its ${phase} deadline`,
		failureKind: "transient",
		deploymentHealth: "penalize",
	});
}
