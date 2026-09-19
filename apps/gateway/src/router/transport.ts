import type { DeploymentCandidate } from "#gateway/deploymentCandidates.ts";
import { operationForCallType } from "#operations/registry.ts";
import { declaredTransportFor } from "#catalog/types.ts";
import type { CallType } from "#core/callType.ts";
import { GatewayError } from "#core/errors.ts";

import {
	type UpstreamTransport,
	isUpstreamTransport,
} from "#core/transport.ts";

/**
 * Resolves the effective transport for an internal call category.
 *
 * Three sources, in this order, because each knows something the next one cannot:
 *
 *  1. The deployment's override — an operator who knows something about THIS account, such as an
 *     Azure resource still on the legacy transcription API.
 *  2. The model's own declaration — which of a provider's APIs this model answers on. Google runs
 *     Veo on `:predictLongRunning` and its omni models on `/interactions`, and no amount of
 *     configuration changes that, so the catalog is where it belongs.
 *  3. The adapter's default — what the provider's models speak unless one of them says otherwise.
 *
 * A transport nothing supports is a configuration error either way, but the message says which of
 * the three chose it: hunting for a deployment setting that was never made is how an afternoon goes.
 */
export function resolveTransport(
	candidate: DeploymentCandidate,
	callType: CallType,
): UpstreamTransport {
	const transports = candidate.adapter.transports?.[callType];
	const operation = operationForCallType(callType);
	const configuredOverride = operation
		? candidate.row.transportOverrides?.[operation.id]
		: undefined;
	if (
		configuredOverride !== undefined &&
		!isUpstreamTransport(configuredOverride)
	) {
		throw new GatewayError({
			class: "server",
			message: `Deployment "${candidate.row.id}" has unknown transport "${configuredOverride}" for ${operation?.id ?? callType}`,
		});
	}
	const declared = operation
		? declaredTransportFor(candidate.meta, operation.id)
		: undefined;
	const source =
		configuredOverride === undefined
			? declared === undefined
				? `falls back to the default transport "${transports?.default}"`
				: `runs model "${candidate.upstreamModel}", which declares transport "${declared}"`
			: `is configured with transport "${configuredOverride}"`;
	const supported = transports?.supported;
	const transport =
		configuredOverride ?? declared ?? transports?.default ?? "chat_completions";
	if (supported && !supported.includes(transport)) {
		throw new GatewayError({
			class: "server",
			message: `Deployment "${candidate.row.id}" ${source}, which adapter "${candidate.adapter.key}" does not support for ${callType} (supported transports: ${supported.join(", ")})`,
		});
	}
	return transport;
}
