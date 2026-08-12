import type { EffectiveSettings } from "#router/settings.ts";
import type { RouteResult } from "#router/index.ts";
import type { Context } from "hono";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "include"]);

export function routingMetadataRequested(c: Context): boolean {
	const value = c.req.header("x-unified-routing-metadata");
	return value !== undefined && ENABLED_VALUES.has(value.toLowerCase());
}

export function publicRoutingMetadata<T>(
	routing: RouteResult<T>,
	settings: EffectiveSettings,
): Record<string, unknown> {
	return {
		served_model: routing.candidate.row.publicModel,
		routing_strategy: settings.routingStrategy,
		unsupported_parameter_strategy: settings.unsupportedParameterStrategy,
		fallback_used: routing.fallbackUsed,
		attempt_count: routing.attempts,
		attempts: routing.attemptLog.map((attempt, index) => ({
			index,
			ok: attempt.ok,
			latency_ms: attempt.ms,
			...(attempt.errorClass !== undefined
				? { error_class: attempt.errorClass }
				: {}),
			...(attempt.httpStatus !== undefined
				? { http_status: attempt.httpStatus }
				: {}),
			...(attempt.deploymentHealth === "neutral"
				? { health_impact: "neutral" }
				: {}),
		})),
	};
}

export function attachRoutingMetadata<T extends Record<string, unknown>>(
	body: T,
	metadata: Record<string, unknown> | null,
): T {
	if (!metadata) return body;
	return { ...body, unified_routing: metadata };
}
