import type { UnsupportedParameterStrategy } from "#catalog/parameters.ts";
import { getRouterSettings } from "#db/repos/router.ts";

import {
	DEFAULT_EXECUTION_POLICIES,
	type ExecutionPolicies,
} from "#core/executionPolicy.ts";

export type RoutingStrategy =
	| "simple-shuffle"
	| "least-busy"
	| "usage-based-tpm"
	| "usage-based-rpm"
	| "latency-based"
	| "throughput-based"
	| "price-based"
	| "health-aware";

export interface EffectiveSettings {
	routingStrategy: RoutingStrategy;
	unsupportedParameterStrategy: UnsupportedParameterStrategy;
	allowedFails: number;
	cooldownSeconds: number;
	failureWindowSeconds: number;
	maxCooldownSeconds: number;
	halfOpenProbeSeconds: number;
	configurationCooldownSeconds: number;
	throttleCooldownSeconds: number;
	executionPolicies: ExecutionPolicies;
	retryAfterSeconds: number;
}

const DEFAULTS: EffectiveSettings = {
	routingStrategy: "simple-shuffle",
	unsupportedParameterStrategy: "drop",
	allowedFails: 3,
	cooldownSeconds: 5,
	failureWindowSeconds: 60,
	maxCooldownSeconds: 300,
	halfOpenProbeSeconds: 30,
	configurationCooldownSeconds: 300,
	throttleCooldownSeconds: 5,
	executionPolicies: DEFAULT_EXECUTION_POLICIES,
	retryAfterSeconds: 0,
};

// Short-lived cache for global config (avoids one SELECT per request).
const GLOBAL_TTL_MS = 5000;
let globalCache: { at: number; value: EffectiveSettings } | undefined;

async function loadGlobal(): Promise<EffectiveSettings> {
	if (globalCache && Date.now() - globalCache.at < GLOBAL_TTL_MS)
		return globalCache.value;
	const row = await getRouterSettings();
	const value: EffectiveSettings = row
		? {
				routingStrategy: row.routingStrategy,
				unsupportedParameterStrategy: row.unsupportedParameterStrategy,
				allowedFails: row.allowedFails,
				cooldownSeconds: row.cooldownSeconds,
				failureWindowSeconds: row.failureWindowSeconds,
				maxCooldownSeconds: row.maxCooldownSeconds,
				halfOpenProbeSeconds: row.halfOpenProbeSeconds,
				configurationCooldownSeconds: row.configurationCooldownSeconds,
				throttleCooldownSeconds: row.throttleCooldownSeconds,
				executionPolicies: row.executionPolicies ?? DEFAULT_EXECUTION_POLICIES,
				retryAfterSeconds: row.retryAfterSeconds,
			}
		: DEFAULTS;
	globalCache = { at: Date.now(), value };
	return value;
}

/** The router's effective global configuration. */
export async function getEffectiveSettings(): Promise<EffectiveSettings> {
	return loadGlobal();
}

/** Makes an administrative settings update visible to the next request immediately. */
export function invalidateRouterSettingsCache(): void {
	globalCache = undefined;
}
