import type { OperationProfiles, TransportOverrides } from "#profiles/types.ts";
import { enforcePublicModelRateLimit } from "./modelsRateLimit.ts";
import { supportedParameterNames } from "#catalog/parameters.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import type { DeploymentRow } from "#db/repos/deployments.ts";
import type { OperationId } from "#operations/registry.ts";
import { getEffectiveSettings } from "#router/settings.ts";
import type { RuntimeModelMetadata } from "#db/schema.ts";
import { OPERATIONS } from "#operations/registry.ts";
import { authMiddleware } from "#auth/middleware.ts";
import { fetchMetrics } from "#router/state.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import { createHash } from "node:crypto";
import type { Context } from "hono";

import {
	getCircuitSnapshots,
	deploymentSubject,
	capacitySubject,
} from "#router/circuit.ts";

import {
	type PublicModelGroup,
	loadPublicModelGroups,
} from "#catalog/publicModels.ts";

type Modality =
	| "text"
	| "image"
	| "audio"
	| "video"
	| "pdf"
	| "file"
	| "embedding"
	| "moderation"
	| "rerank";

function operationIds(meta: ResolvedModelMetadata): OperationId[] {
	return Object.keys(meta.operations ?? {}) as OperationId[];
}

function operationEndpoints(operationId: OperationId): string[] {
	return [
		...(OPERATIONS.find((operation) => operation.id === operationId)
			?.publicEndpoints ?? []),
	];
}

function addModalitiesForOperation(
	input: Set<Modality>,
	output: Set<Modality>,
	operationId: OperationId,
	profile: OperationProfiles[OperationId] | undefined,
	meta: ResolvedModelMetadata,
): void {
	const textProfile = operationId === "text.generate" ? profile : undefined;
	const explicit =
		textProfile && "modalities" in textProfile
			? textProfile.modalities
			: undefined;
	if (explicit?.input) for (const value of explicit.input) input.add(value);
	if (explicit?.output) for (const value of explicit.output) output.add(value);
	if (explicit?.input || explicit?.output) return;

	switch (operationId) {
		case "text.generate":
			input.add("text");
			if (meta.capabilities.vision) input.add("image");
			output.add("text");
			break;
		case "image.generate":
			input.add("text");
			output.add("image");
			break;
		case "image.edit":
			input.add("text");
			input.add("image");
			output.add("image");
			break;
		case "video.generate":
			input.add("text");
			input.add("image");
			output.add("video");
			break;
		case "audio.transcribe":
			input.add("audio");
			input.add("file");
			output.add("text");
			break;
		case "embedding.create":
			input.add("text");
			output.add("embedding");
			break;
		case "rerank":
			input.add("text");
			output.add("rerank");
			break;
	}
}

function aggregateModalities(metas: ResolvedModelMetadata[]): {
	input: string[];
	output: string[];
	modality: string;
} {
	const input = new Set<Modality>();
	const output = new Set<Modality>();
	for (const meta of metas) {
		for (const operationId of operationIds(meta)) {
			addModalitiesForOperation(
				input,
				output,
				operationId,
				meta.operations?.[operationId],
				meta,
			);
		}
	}
	const inputList = [...input].sort();
	const outputList = [...output].sort();
	const modality = `${inputList.join("+") || "unknown"}->${
		outputList.join("+") || "unknown"
	}`;
	return { input: inputList, output: outputList, modality };
}

function centsPerMillionToUsdPerToken(
	value: number | undefined,
): string | undefined {
	if (value === undefined) return undefined;
	const normalized = value / 100_000_000;
	if (normalized === 0) return "0";
	return normalized.toFixed(12).replace(/\.?0+$/, "");
}

function minDefined(values: Array<number | undefined>): number | undefined {
	let min: number | undefined;
	for (const value of values) {
		if (value === undefined) continue;
		if (min === undefined || value < min) min = value;
	}
	return min;
}

function publicPricing(metas: ResolvedModelMetadata[]): Record<string, string> {
	const pricing = metas.map((meta) => meta.pricing).filter(Boolean);
	const result: Record<string, string> = {};
	const prompt = centsPerMillionToUsdPerToken(
		minDefined(pricing.map((p) => p?.inputCentsPerMTokens)),
	);
	const completion = centsPerMillionToUsdPerToken(
		minDefined(pricing.map((p) => p?.outputCentsPerMTokens)),
	);
	const cacheRead = centsPerMillionToUsdPerToken(
		minDefined(pricing.map((p) => p?.cacheReadCentsPerMTokens)),
	);
	const cacheWrite = centsPerMillionToUsdPerToken(
		minDefined(pricing.map((p) => p?.cacheWriteCentsPerMTokens)),
	);
	const searchUnitCents = minDefined(pricing.map((p) => p?.searchUnitCents));
	if (prompt !== undefined) result.prompt = prompt;
	if (completion !== undefined) result.completion = completion;
	if (cacheRead !== undefined) result.input_cache_read = cacheRead;
	if (cacheWrite !== undefined) result.input_cache_write = cacheWrite;
	if (searchUnitCents !== undefined)
		result.search_unit =
			searchUnitCents === 0
				? "0"
				: (searchUnitCents / 100).toFixed(12).replace(/\.?0+$/, "");
	return result;
}

function publicOperations(metas: ResolvedModelMetadata[]): Array<{
	id: OperationId;
	endpoints: string[];
}> {
	const ids = new Set<OperationId>();
	for (const meta of metas) for (const id of operationIds(meta)) ids.add(id);
	return [...ids].sort().map((id) => ({
		id,
		endpoints: operationEndpoints(id),
	}));
}

function aggregateSupportedParameters(
	metas: ResolvedModelMetadata[],
): string[] {
	const names = new Set<string>();
	for (const meta of metas) {
		for (const parameter of supportedParameterNames(meta)) names.add(parameter);
	}
	return [...names].sort();
}

function topProvider(metas: ResolvedModelMetadata[]): Record<string, unknown> {
	return {
		context_length:
			Math.max(0, ...metas.map((meta) => meta.maxInputTokens ?? 0)) || null,
		max_completion_tokens:
			Math.max(0, ...metas.map((meta) => meta.maxOutputTokens ?? 0)) || null,
	};
}

function toModelObject(group: PublicModelGroup): Record<string, unknown> {
	const architecture = aggregateModalities(group.metas);
	return {
		id: group.name,
		object: "model",
		created: Math.floor(group.createdAt.getTime() / 1000),
		owned_by: "Boelabs",
		architecture: {
			modality: architecture.modality,
			input_modalities: architecture.input,
			output_modalities: architecture.output,
		},
		top_provider: topProvider(group.metas),
		pricing: publicPricing(group.metas),
		operations: publicOperations(group.metas),
		supported_parameters: aggregateSupportedParameters(group.metas),
		endpoint_count: group.rows.length,
	};
}

function publicDeploymentId(row: DeploymentRow): string {
	return `dep_${createHash("sha256").update(row.id).digest("hex").slice(0, 12)}`;
}

function transportOverrides(row: DeploymentRow): TransportOverrides {
	return row.transportOverrides ?? {};
}

function deploymentPricing(
	pricing: RuntimeModelMetadata["pricing"] | undefined,
): Record<string, string> {
	return publicPricing([
		{
			capabilities: {
				tools: true,
				vision: true,
				reasoning: false,
				structuredOutputs: false,
			},
			...(pricing !== undefined ? { pricing } : {}),
		},
	]);
}

async function deploymentObjects(group: PublicModelGroup): Promise<object[]> {
	const settings = await getEffectiveSettings();
	const circuitsEnabled = settings.cooldownSeconds > 0;
	const [metrics, circuits] = await Promise.all([
		fetchMetrics(group.rows.map((row) => row.id)),
		circuitsEnabled
			? getCircuitSnapshots(
					group.rows.map((row) => ({
						deployment: deploymentSubject(row.id),
						capacity: capacitySubject(row.id, row.failureDomain),
					})),
				)
			: Promise.resolve(
					group.rows.map(() => ({
						status: "available" as const,
						retryAfterMs: null,
					})),
				),
	]);
	return group.rows.map((row, index) => {
		const meta = group.metas[index]!;
		const m = metrics.get(row.id);
		const circuit = circuits[index] ?? {
			status: "available" as const,
			retryAfterMs: null,
		};
		return {
			id: publicDeploymentId(row),
			object: "model.deployment",
			model: row.publicModel,
			provider: row.adapterKey,
			status: circuit.status,
			retry_after_ms: circuit.retryAfterMs,
			created: Math.floor(row.createdAt.getTime() / 1000),
			weight: row.weight,
			limits: {
				rpm: row.rpmLimit,
				tpm: row.tpmLimit,
			},
			top_provider: topProvider([meta]),
			pricing: deploymentPricing(meta.pricing),
			operations: publicOperations([meta]),
			supported_parameters: supportedParameterNames(meta),
			transports: Object.fromEntries(
				Object.entries(transportOverrides(row)).filter(([, value]) => value),
			),
			metrics: {
				inflight: m?.inflight ?? 0,
				rpm: m?.rpm ?? 0,
				tpm: m?.tpm ?? 0,
				health_score: m?.healthScore ?? 1,
				latency_ms: m?.latencyMs ?? null,
				throughput_tps: m?.throughputTps ?? null,
			},
		};
	});
}

function notFound(id: string): GatewayError {
	return new GatewayError({
		class: "not_found",
		message: `Model "${id}" not found`,
		code: "model_not_found",
	});
}

function wildcardModelId(c: Context<AppEnv>): {
	model: string;
	deployments: boolean;
} {
	const prefix = "/v1/models/";
	const raw = c.req.path.startsWith(prefix)
		? c.req.path.slice(prefix.length)
		: "";
	if (!raw) throw notFound("");
	const suffix = "/deployments";
	const deployments = raw.endsWith(suffix);
	const model = deployments ? raw.slice(0, -suffix.length) : raw;
	return { model: decodeURIComponent(model), deployments };
}

/** GET /v1/models - public model discovery with OpenAI-compatible base fields. */
export async function listModelsHandler(c: Context<AppEnv>): Promise<Response> {
	enforcePublicModelRateLimit(c);
	const groups = await loadPublicModelGroups();
	const data = [...groups.values()]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(toModelObject);
	return c.json({ object: "list", data });
}

/**
 * GET /v1/models/{id} - public model metadata (pricing, capabilities). GET /v1/models/{id}/deployments
 * requires a key: unlike the model-level catalog, per-deployment data (routing weight, rate limits,
 * live health/latency/throughput) is operator infrastructure detail, not public model information.
 */
export async function modelsWildcardHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const { model, deployments } = wildcardModelId(c);
	if (deployments) await authMiddleware()(c, async () => {});
	else enforcePublicModelRateLimit(c);
	const groups = await loadPublicModelGroups();
	const group = groups.get(model);
	if (!group) throw notFound(model);
	if (!deployments) return c.json(toModelObject(group));
	return c.json({
		object: "list",
		data: await deploymentObjects(group),
	});
}
