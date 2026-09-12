import { resolveModelMetadata } from "#catalog/index.ts";
import { GatewayError } from "#core/errors.ts";

import {
	callTypeForOperation,
	operationForCallType,
	type OperationId,
	OPERATION_IDS,
} from "#operations/registry.ts";

import {
	type FallbackPolicyRow,
	upsertFallbackPolicy,
	type FallbackReason,
} from "#db/repos/router.ts";

import {
	listDeploymentsByPublicModel,
	type DeploymentRow,
} from "#db/repos/deployments.ts";

export interface ConfigureFallbackInput {
	primaryModel: string;
	fallbackModels: string[];
	reason?: FallbackReason;
}

function deploymentOperations(row: DeploymentRow): Set<OperationId> {
	const meta = resolveModelMetadata(
		row.adapterKey,
		row.upstreamModel,
		row.catalogEntry,
		row.pricing,
	);
	const operations = new Set<OperationId>();
	for (const callType of meta.supportedCallTypes ?? []) {
		const operation = operationForCallType(callType);
		if (operation) operations.add(operation.id);
	}
	for (const operation of OPERATION_IDS) {
		if (
			callTypeForOperation(operation) &&
			meta.operations?.[operation] !== undefined
		) {
			operations.add(operation);
		}
	}
	return operations;
}

async function publicModelOperations(
	publicModel: string,
): Promise<Set<OperationId> | undefined> {
	const deployments = await listDeploymentsByPublicModel(publicModel, {
		includeDisabled: true,
	});
	if (deployments.length === 0) return undefined;
	const operations = new Set<OperationId>();
	for (const deployment of deployments) {
		for (const operation of deploymentOperations(deployment))
			operations.add(operation);
	}
	return operations;
}

function invalid(message: string, param: string): never {
	throw new GatewayError({ class: "bad_request", message, param });
}

/**
 * Configures a chain per (primary public model, reason).
 *
 * Existence and compatibility are computed against all persisted deployments, including disabled ones:
 * disabling is temporary and must not destroy a valid configuration. At runtime the router re-filters
 * to only the enabled deployments compatible with the actual request.
 */
export async function configureFallback(
	input: ConfigureFallbackInput,
): Promise<FallbackPolicyRow> {
	if (input.fallbackModels.length < 1 || input.fallbackModels.length > 5) {
		invalid(
			"fallbackModels must contain between 1 and 5 public models",
			"fallbackModels",
		);
	}
	if (input.fallbackModels.includes(input.primaryModel)) {
		invalid(
			"The primary model cannot be in its own fallback chain",
			"fallbackModels",
		);
	}
	if (new Set(input.fallbackModels).size !== input.fallbackModels.length) {
		invalid("Fallback models cannot be repeated", "fallbackModels");
	}

	const primaryOperations = await publicModelOperations(input.primaryModel);
	if (!primaryOperations) {
		invalid(
			`Primary public model "${input.primaryModel}" has no deployments`,
			"primaryModel",
		);
	}

	const targets = await Promise.all(
		input.fallbackModels.map((publicModel) =>
			publicModelOperations(publicModel),
		),
	);
	for (const [index, operations] of targets.entries()) {
		const publicModel = input.fallbackModels[index]!;
		if (!operations) {
			invalid(
				`Fallback public model "${publicModel}" has no deployments`,
				`fallbackModels.${index}`,
			);
		}
		const shared = [...operations].filter((operation) =>
			primaryOperations.has(operation),
		);
		if (shared.length === 0) {
			invalid(
				`Fallback public model "${publicModel}" shares no executable operation with "${input.primaryModel}"`,
				`fallbackModels.${index}`,
			);
		}
	}

	return upsertFallbackPolicy({
		primaryModel: input.primaryModel,
		fallbackModels: input.fallbackModels,
		reason: input.reason ?? "general",
	});
}
