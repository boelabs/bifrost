import { resolveModelMetadata, getCatalogEntry } from "#catalog/index.ts";
import { invalidatePublicModelGroups } from "#catalog/publicModels.ts";
import type { TransportOverrides } from "#profiles/types.ts";
import type { RuntimeModelMetadata } from "#db/schema.ts";
import { isUpstreamTransport } from "#core/transport.ts";
import type { CatalogEntry } from "#catalog/types.ts";
import { getAdapter } from "#adapters/registry.ts";
import type { Adapter } from "#adapters/types.ts";
import { GatewayError } from "#core/errors.ts";

import {
	updateDeployment as persistDeployment,
	createDeployment as insertDeployment,
	deleteDeployment as removeDeployment,
	PublicModelReferencedError,
	type DeploymentRow,
	getDeploymentById,
} from "#db/repos/deployments.ts";

import {
	callTypeForOperation,
	operationForCallType,
	type OperationId,
	OPERATION_IDS,
	OPERATIONS,
} from "#operations/registry.ts";

/** Data needed to resolve operations, metadata, and transportOverrides. */
export interface PreviewDeploymentInput {
	publicModel: string;
	adapterKey: string;
	upstreamModel: string;
	/** 1:1 CatalogEntry for custom models (not in the catalog). For known ones it must be absent. */
	catalogEntry?: CatalogEntry;
	pricing?: RuntimeModelMetadata["pricing"];
	transportOverrides?: TransportOverrides;
}

export interface CreateDeploymentInput extends PreviewDeploymentInput {
	/** Plaintext credentials; the repo encrypts them. */
	credentials: Record<string, unknown>;
	label?: string | null;
	failureDomain?: string | null;
	metadata?: Record<string, unknown>;
	enabled?: boolean;
	weight?: number;
	tpmLimit?: number | null;
	rpmLimit?: number | null;
}

export interface UpdateDeploymentInput {
	publicModel?: string;
	upstreamModel?: string;
	credentials?: Record<string, unknown>;
	label?: string | null;
	failureDomain?: string | null;
	metadata?: Record<string, unknown>;
	catalogEntry?: CatalogEntry | null;
	pricing?: RuntimeModelMetadata["pricing"] | null;
	transportOverrides?: TransportOverrides;
	enabled?: boolean;
	weight?: number;
	tpmLimit?: number | null;
	rpmLimit?: number | null;
}

interface ResolvedOperationView {
	id: OperationId;
	callType?: string;
	publicEndpoints: string[];
	transport?: string;
	profile: unknown;
}

export interface DeploymentPreview {
	publicModel: string;
	adapterKey: string;
	upstreamModel: string;
	/** "catalog" = known model from catalog.json; "custom" = inline CatalogEntry. */
	source: "catalog" | "custom";
	operations: ResolvedOperationView[];
	effective: ReturnType<typeof resolveModelMetadata>;
	transportOverrides: TransportOverrides;
}

function validateCustomCatalogEntry(
	adapter: NonNullable<ReturnType<typeof getAdapter>>,
	entry: CatalogEntry,
): void {
	const kind = entry.operations["text.generate"]?.reasoning?.kind;
	if (kind && adapter.reasoningKinds && !adapter.reasoningKinds.has(kind)) {
		throw new GatewayError({
			class: "bad_request",
			message: `Adapter "${adapter.key}" cannot emit reasoning.kind "${kind}"`,
			param: "catalogEntry.operations.text.generate.reasoning.kind",
		});
	}
}

function validateRequiredCredentials(
	adapter: Adapter,
	credentials: Record<string, unknown>,
): void {
	for (const key of adapter.credentials.required) {
		if (typeof credentials[key] !== "string" || credentials[key] === "") {
			throw new GatewayError({
				class: "bad_request",
				message: `Credential "${key}" is required`,
				param: `credentials.${key}`,
			});
		}
	}
}

function selectedOperationIds(
	meta: ReturnType<typeof resolveModelMetadata>,
): OperationId[] {
	const selected = new Set<OperationId>();
	for (const callType of meta.supportedCallTypes ?? []) {
		const operation = operationForCallType(callType);
		if (operation) selected.add(operation.id);
	}
	for (const operation of OPERATION_IDS) {
		if (meta.operations?.[operation] !== undefined) selected.add(operation);
	}
	return [...selected];
}

/** Per-operation transport = explicit override > adapter-inferred default. */
function resolveTransportOverrides(
	adapter: NonNullable<ReturnType<typeof getAdapter>>,
	requested: TransportOverrides | undefined,
	operations: OperationId[],
): TransportOverrides {
	const result: TransportOverrides = {};
	for (const operationId of operations) {
		const callType = callTypeForOperation(operationId);
		const transport =
			requested?.[operationId] ??
			(callType ? adapter.transports?.[callType]?.default : undefined);
		if (!callType || !adapter.supportedCallTypes.has(callType)) {
			throw new GatewayError({
				class: "bad_request",
				message: `Adapter "${adapter.key}" does not implement operation "${operationId}"`,
				param: `operations.${operationId}`,
			});
		}
		if (!transport) {
			throw new GatewayError({
				class: "bad_request",
				message: `No transport can execute operation "${operationId}" with adapter "${adapter.key}"`,
				param: `transportOverrides.${operationId}`,
			});
		}
		if (
			!isUpstreamTransport(transport) ||
			!adapter.transports?.[callType]?.supported.includes(transport)
		) {
			throw new GatewayError({
				class: "bad_request",
				message: `Adapter "${adapter.key}" cannot use transport "${transport}" for operation "${operationId}"`,
				param: `transportOverrides.${operationId}`,
			});
		}
		result[operationId] = transport;
	}
	return result;
}

export async function previewDeployment(
	input: PreviewDeploymentInput,
): Promise<DeploymentPreview> {
	const adapter = getAdapter(input.adapterKey);
	if (!adapter) {
		throw new GatewayError({
			class: "bad_request",
			message: `Adapter "${input.adapterKey}" is not registered`,
			param: "adapterKey",
		});
	}
	const inCatalog =
		getCatalogEntry(input.adapterKey, input.upstreamModel) !== undefined;
	// Binary rule: known -> internal catalog.json; custom -> CatalogEntry required.
	if (inCatalog && input.catalogEntry) {
		const message = `"${input.upstreamModel}" is already in the "${input.adapterKey}" catalog; omit catalogEntry because catalog models cannot be overridden`;
		throw new GatewayError({
			class: "bad_request",
			message,
			publicMessage: message,
			param: "catalogEntry",
		});
	}
	if (!inCatalog && !input.catalogEntry) {
		const message = `"${input.upstreamModel}" is not in the "${input.adapterKey}" catalog; provide catalogEntry for this custom model`;
		throw new GatewayError({
			class: "bad_request",
			message,
			publicMessage: message,
			param: "catalogEntry",
		});
	}
	if (!inCatalog) validateCustomCatalogEntry(adapter, input.catalogEntry!);
	const effective = resolveModelMetadata(
		input.adapterKey,
		input.upstreamModel,
		inCatalog ? undefined : input.catalogEntry,
		input.pricing,
	);
	const operationIds = selectedOperationIds(effective);
	const executable = operationIds.filter(
		(operation) => callTypeForOperation(operation) !== undefined,
	);
	if (executable.length === 0) {
		throw new GatewayError({
			class: "bad_request",
			message: "The model has no executable operation.",
			param: "catalogEntry.operations",
		});
	}
	const transportOverrides = resolveTransportOverrides(
		adapter,
		input.transportOverrides,
		operationIds,
	);
	return {
		publicModel: input.publicModel,
		adapterKey: input.adapterKey,
		upstreamModel: input.upstreamModel,
		source: inCatalog ? "catalog" : "custom",
		operations: operationIds.map((operationId) => {
			const definition = OPERATIONS.find(
				(candidate) => candidate.id === operationId,
			);
			if (!definition)
				throw new Error(`Missing operation definition ${operationId}`);
			const callType = callTypeForOperation(operationId);
			return {
				id: operationId,
				...(callType ? { callType } : {}),
				publicEndpoints: [...definition.publicEndpoints],
				...(transportOverrides[operationId]
					? { transport: transportOverrides[operationId] }
					: {}),
				profile: effective.operations?.[operationId] ?? null,
			};
		}),
		effective,
		transportOverrides,
	};
}

export async function createDeployment(
	input: CreateDeploymentInput,
): Promise<{ row: DeploymentRow; preview: DeploymentPreview }> {
	const preview = await previewDeployment(input);
	const adapter = getAdapter(input.adapterKey);
	if (!adapter) {
		throw new GatewayError({
			class: "bad_request",
			message: `Adapter "${input.adapterKey}" is not registered`,
			param: "adapterKey",
		});
	}
	validateRequiredCredentials(adapter, input.credentials);
	const row = await insertDeployment({
		publicModel: input.publicModel,
		adapterKey: input.adapterKey,
		upstreamModel: input.upstreamModel,
		credentials: input.credentials,
		label: input.label ?? null,
		failureDomain: input.failureDomain ?? null,
		metadata: input.metadata ?? {},
		catalogEntry:
			preview.source === "custom" ? (input.catalogEntry ?? null) : null,
		pricing: input.pricing ?? null,
		transportOverrides: input.transportOverrides ?? {},
		...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
		...(input.weight !== undefined ? { weight: input.weight } : {}),
		...(input.tpmLimit !== undefined ? { tpmLimit: input.tpmLimit } : {}),
		...(input.rpmLimit !== undefined ? { rpmLimit: input.rpmLimit } : {}),
	});
	invalidatePublicModelGroups();
	return { row, preview };
}

export async function updateDeployment(
	id: string,
	patch: UpdateDeploymentInput,
): Promise<{ row: DeploymentRow; preview: DeploymentPreview }> {
	const existing = await getDeploymentById(id);
	if (!existing) {
		throw new GatewayError({
			class: "not_found",
			message: `Deployment "${id}" does not exist`,
		});
	}
	const catalogEntry =
		patch.catalogEntry !== undefined
			? (patch.catalogEntry ?? undefined)
			: (existing.catalogEntry ?? undefined);
	const input: PreviewDeploymentInput = {
		publicModel: patch.publicModel ?? existing.publicModel,
		adapterKey: existing.adapterKey,
		upstreamModel: patch.upstreamModel ?? existing.upstreamModel,
		transportOverrides: patch.transportOverrides ?? existing.transportOverrides,
		...(catalogEntry ? { catalogEntry } : {}),
		...(patch.pricing !== undefined
			? patch.pricing
				? { pricing: patch.pricing }
				: {}
			: existing.pricing
				? { pricing: existing.pricing }
				: {}),
	};
	const preview = await previewDeployment(input);
	const adapter = getAdapter(input.adapterKey);
	if (!adapter) {
		throw new GatewayError({
			class: "bad_request",
			message: `Adapter "${input.adapterKey}" is not registered`,
			param: "adapterKey",
		});
	}
	if (patch.credentials !== undefined)
		validateRequiredCredentials(adapter, patch.credentials);
	let row: DeploymentRow | undefined;
	try {
		row = await persistDeployment(id, {
			upstreamModel: input.upstreamModel,
			publicModel: input.publicModel,
			catalogEntry: preview.source === "custom" ? (catalogEntry ?? null) : null,
			transportOverrides: input.transportOverrides ?? {},
			enabled: patch.enabled ?? existing.enabled,
			weight: patch.weight ?? existing.weight,
			tpmLimit:
				patch.tpmLimit !== undefined ? patch.tpmLimit : existing.tpmLimit,
			rpmLimit:
				patch.rpmLimit !== undefined ? patch.rpmLimit : existing.rpmLimit,
			...(patch.pricing !== undefined ? { pricing: patch.pricing } : {}),
			...(patch.credentials !== undefined
				? { credentials: patch.credentials }
				: {}),
			...(patch.label !== undefined ? { label: patch.label } : {}),
			...(patch.failureDomain !== undefined
				? { failureDomain: patch.failureDomain }
				: {}),
			...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
		});
	} catch (error) {
		if (error instanceof PublicModelReferencedError) {
			throw new GatewayError({
				class: "bad_request",
				message: `${error.message}; reconfigure its fallbacks before renaming it`,
				param: "publicModel",
			});
		}
		throw error;
	}
	if (!row)
		throw new GatewayError({
			class: "not_found",
			message: `Deployment "${id}" does not exist`,
		});
	invalidatePublicModelGroups();
	return { row, preview };
}

export async function deleteDeployment(id: string): Promise<void> {
	await removeDeployment(id);
	invalidatePublicModelGroups();
}
