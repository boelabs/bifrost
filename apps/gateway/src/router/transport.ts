import type { DeploymentCandidate } from "#gateway/deploymentCandidates.ts";
import { operationForCallType } from "#operations/registry.ts";
import type { CallType } from "#core/callType.ts";
import { GatewayError } from "#core/errors.ts";

import {
	type UpstreamTransport,
	isUpstreamTransport,
} from "#core/transport.ts";

/** Resolves the effective transport for an internal call category. */
export function resolveTransport(
	candidate: DeploymentCandidate,
	callType: CallType,
	preferredTransport?: UpstreamTransport,
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
	const supported = transports?.supported;
	const nativePreference =
		preferredTransport !== undefined && supported?.includes(preferredTransport)
			? preferredTransport
			: undefined;
	const transport =
		configuredOverride ??
		nativePreference ??
		transports?.default ??
		"chat_completions";
	if (supported && !supported.includes(transport)) {
		throw new GatewayError({
			class: "server",
			message: `Deployment "${candidate.row.id}" is configured with transport "${transport}", which adapter "${candidate.adapter.key}" does not support for ${callType} (supported transports: ${supported.join(", ")})`,
		});
	}
	return transport;
}
