import { ADAPTER_KEY_PATTERN, ADAPTER_KEY_RULE } from "#adapters/key.ts";
import { ADMIN_JSON_BODY_MAX_BYTES, readJsonBody } from "#http/body.ts";
import { getAdapter, listAdapters } from "#adapters/registry.ts";
import type { RuntimeModelMetadata } from "#db/schema.ts";
import type { CatalogEntry } from "#catalog/types.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import { ok } from "#http/respond.ts";
import { Hono } from "hono";
import * as z from "zod/v4";

import {
	type PreviewDeploymentInput,
	type CreateDeploymentInput,
	type UpdateDeploymentInput,
	previewDeployment,
	createDeployment,
	updateDeployment,
} from "#deployments/service.ts";

import {
	listDeploymentsPage,
	type DeploymentRow,
	getDeploymentById,
	deleteDeployment,
} from "#db/repos/deployments.ts";

import {
	customCatalogEntrySchema,
	transportOverridesSchema,
	pricingSchema,
} from "#profiles/schema.ts";

import {
	type OperationDefinition,
	callTypeForOperation,
	OPERATIONS,
} from "#operations/registry.ts";

async function parseJson<T>(
	c: import("hono").Context<AppEnv>,
	schema: z.ZodType<T>,
): Promise<T> {
	const json = await readJsonBody(c, ADMIN_JSON_BODY_MAX_BYTES);
	const parsed = schema.safeParse(json);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		throw new GatewayError({
			class: "bad_request",
			message: parsed.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; "),
			param: first ? first.path.join(".") : null,
		});
	}
	return parsed.data;
}

const adapterKeySchema = z
	.string()
	.min(1)
	.max(80)
	.regex(ADAPTER_KEY_PATTERN, ADAPTER_KEY_RULE);

/** Operator-facing label for a deployment. `null` clears it on update. */
const labelSchema = z.string().min(1).max(200).nullable();
const failureDomainSchema = z.string().min(1).max(200).nullable();

// Free-form operator annotations: a JSON object capped at 16 KiB. It is stored as jsonb and echoed
// back verbatim (never merged into a live object), so prototype-polluting keys are not a concern here.
const metadataSchema = z
	.record(z.string(), z.unknown())
	.refine((m) => Buffer.byteLength(JSON.stringify(m), "utf8") <= 16_384, {
		message: "metadata exceeds the 16 KiB limit",
	});

/** Strips the encrypted credentials before returning a deployment. */
function deploymentView(row: DeploymentRow) {
	return {
		id: row.id,
		publicModel: row.publicModel,
		adapterKey: row.adapterKey,
		upstreamModel: row.upstreamModel,
		label: row.label,
		failureDomain: row.failureDomain,
		metadata: row.metadata,
		custom: row.catalogEntry != null,
		catalogEntry: row.catalogEntry,
		pricing: row.pricing,
		transportOverrides: row.transportOverrides,
		enabled: row.enabled,
		weight: row.weight,
		tpmLimit: row.tpmLimit,
		rpmLimit: row.rpmLimit,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export const createDeploymentSchema = z
	.object({
		publicModel: z.string().min(1).max(200),
		adapterKey: adapterKeySchema,
		upstreamModel: z.string().min(1).max(300),
		credentials: z.record(z.string(), z.unknown()),
		label: labelSchema.optional(),
		failureDomain: failureDomainSchema.optional(),
		metadata: metadataSchema.optional(),
		catalogEntry: customCatalogEntrySchema.optional(),
		pricing: pricingSchema.optional(),
		transportOverrides: transportOverridesSchema.optional(),
		enabled: z.boolean().optional(),
		weight: z.int().min(0).optional(),
		tpmLimit: z.int().nullable().optional(),
		rpmLimit: z.int().nullable().optional(),
	})
	.strict();

const resolveDeploymentSchema = z
	.object({
		publicModel: z.string().min(1).max(200),
		adapterKey: adapterKeySchema,
		upstreamModel: z.string().min(1).max(300),
		catalogEntry: customCatalogEntrySchema.optional(),
		pricing: pricingSchema.optional(),
		transportOverrides: transportOverridesSchema.optional(),
		// Accepted (and ignored) so the same body as POST /deployments can be reused.
		credentials: z.record(z.string(), z.unknown()).optional(),
		label: labelSchema.optional(),
		failureDomain: failureDomainSchema.optional(),
		metadata: metadataSchema.optional(),
	})
	.strict();

export const updateDeploymentSchema = z
	.object({
		publicModel: z.string().min(1).max(200).optional(),
		upstreamModel: z.string().min(1).max(300).optional(),
		credentials: z.record(z.string(), z.unknown()).optional(),
		label: labelSchema.optional(),
		failureDomain: failureDomainSchema.optional(),
		metadata: metadataSchema.optional(),
		catalogEntry: customCatalogEntrySchema.nullable().optional(),
		pricing: pricingSchema.nullable().optional(),
		transportOverrides: transportOverridesSchema.optional(),
		enabled: z.boolean().optional(),
		weight: z.int().min(0).optional(),
		tpmLimit: z.int().nullable().optional(),
		rpmLimit: z.int().nullable().optional(),
	})
	.strict();

/** Validates that the requested code adapter exists. */
function resolveAdapterKey(adapterKey: string): string {
	if (!getAdapter(adapterKey)) {
		throw new GatewayError({
			class: "bad_request",
			message: `Adapter "${adapterKey}" is not registered`,
			param: "adapterKey",
		});
	}
	return adapterKey;
}

export const platformAdminApp = new Hono<AppEnv>();

function publicOperationView(operation: OperationDefinition) {
	return {
		id: operation.id,
		family: operation.family,
		label: operation.label,
		callType: operation.callType,
		publicEndpoints: [...operation.publicEndpoints],
	};
}

platformAdminApp.get("/operations", (c) =>
	ok(c, {
		operations: OPERATIONS.map(publicOperationView),
		adapters: listAdapters().map((adapter) => ({
			id: adapter.key,
			credentials: { required: [...adapter.credentials.required] },
			supportedCallTypes: [...adapter.supportedCallTypes].sort(),
			operations: OPERATIONS.flatMap((operation) => {
				const callType = callTypeForOperation(operation.id);
				if (!callType || !adapter.supportedCallTypes.has(callType)) return [];
				const transports = adapter.transports?.[callType];
				return [
					{
						...publicOperationView(operation),
						callType,
						transports: transports?.supported ?? [],
						defaultTransport: transports?.default ?? null,
						contentInputs: Object.fromEntries(
							(transports?.supported ?? []).flatMap((transport) => {
								const support = adapter.contentInputs?.[transport];
								return support ? [[transport, support]] : [];
							}),
						),
					},
				];
			}),
		})),
	}),
);

/* ----------------------------------------------------------- deployments */

platformAdminApp.post("/deployments/resolve", async (c) => {
	const input = await parseJson(c, resolveDeploymentSchema);
	const adapterKey = resolveAdapterKey(input.adapterKey);
	const previewInput: PreviewDeploymentInput = {
		publicModel: input.publicModel,
		adapterKey,
		upstreamModel: input.upstreamModel,
		...(input.transportOverrides !== undefined
			? { transportOverrides: input.transportOverrides }
			: {}),
		...(input.catalogEntry !== undefined
			? { catalogEntry: input.catalogEntry as CatalogEntry }
			: {}),
		...(input.pricing !== undefined
			? { pricing: input.pricing as RuntimeModelMetadata["pricing"] }
			: {}),
	};
	return ok(c, await previewDeployment(previewInput));
});

platformAdminApp.get("/deployments", async (c) => {
	const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
	const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
	const result = await listDeploymentsPage({ limit, offset });
	return c.json({
		data: result.rows.map(deploymentView),
		pagination: {
			limit,
			offset,
			total: result.total,
			nextOffset: offset + limit < result.total ? offset + limit : null,
		},
	});
});

platformAdminApp.post("/deployments", async (c) => {
	const input = await parseJson(c, createDeploymentSchema);
	const adapterKey = resolveAdapterKey(input.adapterKey);
	const createInput: CreateDeploymentInput = {
		publicModel: input.publicModel,
		adapterKey,
		upstreamModel: input.upstreamModel,
		credentials: input.credentials,
		...(input.transportOverrides !== undefined
			? { transportOverrides: input.transportOverrides }
			: {}),
		...(input.label !== undefined ? { label: input.label } : {}),
		...(input.failureDomain !== undefined
			? { failureDomain: input.failureDomain }
			: {}),
		...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
		...(input.catalogEntry !== undefined
			? { catalogEntry: input.catalogEntry as CatalogEntry }
			: {}),
		...(input.pricing !== undefined
			? { pricing: input.pricing as RuntimeModelMetadata["pricing"] }
			: {}),
		...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
		...(input.weight !== undefined ? { weight: input.weight } : {}),
		...(input.tpmLimit !== undefined ? { tpmLimit: input.tpmLimit } : {}),
		...(input.rpmLimit !== undefined ? { rpmLimit: input.rpmLimit } : {}),
	};
	const result = await createDeployment(createInput);
	return ok(
		c,
		{ ...deploymentView(result.row), resolved: result.preview },
		201,
	);
});

platformAdminApp.get("/deployments/:id", async (c) => {
	const row = await getDeploymentById(c.req.param("id"));
	if (!row)
		throw new GatewayError({
			class: "not_found",
			message: "Deployment not found",
		});
	return ok(c, deploymentView(row));
});

platformAdminApp.patch("/deployments/:id", async (c) => {
	const input = await parseJson(c, updateDeploymentSchema);
	const patch: UpdateDeploymentInput = {
		...(input.publicModel !== undefined
			? { publicModel: input.publicModel }
			: {}),
		...(input.upstreamModel !== undefined
			? { upstreamModel: input.upstreamModel }
			: {}),
		...(input.credentials !== undefined
			? { credentials: input.credentials }
			: {}),
		...(input.label !== undefined ? { label: input.label } : {}),
		...(input.failureDomain !== undefined
			? { failureDomain: input.failureDomain }
			: {}),
		...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
		...(input.catalogEntry !== undefined
			? { catalogEntry: input.catalogEntry as CatalogEntry | null }
			: {}),
		...(input.pricing !== undefined
			? { pricing: input.pricing as RuntimeModelMetadata["pricing"] | null }
			: {}),
		...(input.transportOverrides !== undefined
			? { transportOverrides: input.transportOverrides }
			: {}),
		...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
		...(input.weight !== undefined ? { weight: input.weight } : {}),
		...(input.tpmLimit !== undefined ? { tpmLimit: input.tpmLimit } : {}),
		...(input.rpmLimit !== undefined ? { rpmLimit: input.rpmLimit } : {}),
	};
	const result = await updateDeployment(c.req.param("id"), patch);
	return ok(c, { ...deploymentView(result.row), resolved: result.preview });
});

platformAdminApp.delete("/deployments/:id", async (c) => {
	const row = await getDeploymentById(c.req.param("id"));
	if (!row)
		throw new GatewayError({
			class: "not_found",
			message: "Deployment not found",
		});
	await deleteDeployment(row.id);
	return c.body(null, 204);
});
