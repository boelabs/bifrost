import type { CanonicalTerminal } from "#gateway/streamLifecycle.ts";
import type { DownstreamWriteObservation } from "./sse.ts";
import type { RouteResult } from "#router/index.ts";
import type { GatewayError } from "#core/errors.ts";
import type { Usage } from "#core/usage.ts";

/**
 * Owns the terminal transition of a routed upstream attempt. Endpoint post-processing is allowed to
 * fail, but it must never strand an inflight counter or half-open circuit permit.
 */
export class RouteLifecycle<TResult> {
	#route: RouteResult<TResult> | null = null;
	#fallbackUsage: Usage | null = null;
	#settled = false;

	attach(route: RouteResult<TResult>): void {
		if (this.#route !== null)
			throw new Error("A route lifecycle cannot own more than one route");
		this.#route = route;
	}

	/** Retains provider-reported usage so a later gateway post-processing failure is still charged. */
	rememberUsage(usage: Usage | null): void {
		if (this.#settled) return;
		this.#fallbackUsage = usage;
	}

	async finish(
		usage: Usage | null,
		error?: GatewayError | null,
		options: {
			finishedAt?: number;
			terminalOverride?: CanonicalTerminal | null;
			downstream?: DownstreamWriteObservation;
		} = {},
	): Promise<void> {
		if (this.#route === null || this.#settled) return;
		this.#settled = true;
		await this.#route.finish(
			usage ?? this.#fallbackUsage,
			options.finishedAt,
			error,
			options.terminalOverride,
			options.downstream,
		);
	}
}
