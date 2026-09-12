import type { components } from "#/shared/api/schema";
import { api, unwrap } from "#/shared/api/client.ts";
import * as z from "zod/v4";

import type {
	CreateDeploymentInput,
	UpdateDeploymentInput,
	AdapterSummary,
} from "./common.ts";

export async function listDeployments(params?: {
	limit?: number;
	offset?: number;
	enabled?: boolean;
	publicModel?: string;
	q?: string;
}) {
	return unwrap(
		await api.GET("/admin/deployments", { params: { query: params } }),
	);
}

export async function createDeployment(
	body: CreateDeploymentInput,
	idempotencyKey?: string,
) {
	return unwrap(
		await api.POST("/admin/deployments", {
			body,
			...(idempotencyKey
				? { headers: { "Idempotency-Key": idempotencyKey } }
				: {}),
		}),
	).data;
}

export async function updateDeployment(
	id: string,
	body: UpdateDeploymentInput,
) {
	return unwrap(
		await api.PATCH("/admin/deployments/{id}", {
			params: { path: { id } },
			body,
		}),
	).data;
}

export async function saveDeployment(
	body: CreateDeploymentInput,
	existingId?: string,
	idempotencyKey?: string,
) {
	await resolveDeployment({
		publicModel: body.publicModel,
		adapterKey: body.adapterKey,
		upstreamModel: body.upstreamModel,
		...(body.catalogEntry !== undefined
			? { catalogEntry: body.catalogEntry }
			: {}),
		...(body.pricing !== undefined ? { pricing: body.pricing } : {}),
		...(body.transportOverrides !== undefined
			? { transportOverrides: body.transportOverrides }
			: {}),
	});
	if (existingId === undefined) return createDeployment(body, idempotencyKey);
	const { adapterKey: _adapterKey, credentials, ...patch } = body;
	return updateDeployment(existingId, {
		...patch,
		catalogEntry: body.catalogEntry ?? null,
		pricing: body.pricing ?? null,
		transportOverrides: body.transportOverrides ?? {},
		...(Object.keys(credentials).length > 0 ? { credentials } : {}),
	});
}

export async function deleteDeployment(id: string): Promise<void> {
	const result = await api.DELETE("/admin/deployments/{id}", {
		params: { path: { id } },
	});
	if (result.error !== undefined) unwrap(result);
}

const adapterRegistrySchema = z.object({
	adapters: z.array(
		z.object({
			id: z.string(),
			credentials: z.object({ required: z.array(z.string()) }),
			supportedCallTypes: z.array(z.string()),
			models: z.array(
				z.object({
					id: z.string(),
					operations: z.array(z.string()),
					deprecated: z.boolean().optional(),
				}),
			),
			operations: z.array(
				z.object({
					id: z.string(),
					label: z.string(),
					transports: z.array(z.string()),
					defaultTransport: z.string().nullable(),
				}),
			),
		}),
	),
});

export async function adapterRegistry(): Promise<{
	adapters: AdapterSummary[];
}> {
	const data = adapterRegistrySchema.parse(
		unwrap(await api.GET("/admin/operations")).data,
	);
	return {
		adapters: data.adapters.slice().sort((a, b) => a.id.localeCompare(b.id)),
	};
}

/**
 * Dry run: resolves the effective capabilities, operations and transports for a body without saving
 * it or encrypting its credentials. Worth doing before a custom catalog entry reaches the database.
 */
export async function resolveDeployment(
	body: components["schemas"]["ResolveDeployment"],
) {
	return unwrap(await api.POST("/admin/deployments/resolve", { body })).data;
}

/**
 * The distinct public model names, for the filter and picker controls on other pages.
 *
 * Deliberately swallows its failure: these are suggestions, not the page's subject. A role that
 * cannot read deployments still gets a working Logs or Keys page, with one filter fewer rather than
 * an error where the table should be.
 */
export async function publicModelNames(): Promise<string[]> {
	return listDeployments({ limit: 200 })
		.then((page) => [
			...new Set(page.data.map((deployment) => deployment.publicModel)),
		])
		.catch(() => []);
}
