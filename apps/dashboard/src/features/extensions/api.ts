import { api, unwrap } from "#/shared/api/client.ts";
import type { InstanceInput } from "./common.ts";
import { cache } from "react";

/**
 * The live runtime, read once per request.
 *
 * Two parts of the extensions page need it — the badge in the header and the status column in the
 * instances table — and they sit in different `<Suspense>` boundaries, so they ask separately.
 * `cache()` is what keeps that one call to the gateway instead of two.
 */
export const runtimeStatus = cache(
	async () => unwrap(await api.GET("/admin/extensions")).data,
);

export async function listArtifacts() {
	return unwrap(await api.GET("/admin/extensions/artifacts")).data;
}

export async function listArtifactVersions(key: string) {
	return unwrap(
		await api.GET("/admin/extensions/artifacts/{key}/versions", {
			params: { path: { key } },
		}),
	).data;
}

export async function uploadArtifact(body: { key: string; code: string }) {
	return unwrap(await api.POST("/admin/extensions/artifacts", { body })).data;
}

export async function activateArtifact(key: string, version: number) {
	return unwrap(
		await api.POST("/admin/extensions/artifacts/{key}/activate", {
			params: { path: { key } },
			body: { version },
		}),
	).data;
}

export async function deleteArtifact(key: string): Promise<void> {
	const result = await api.DELETE("/admin/extensions/artifacts/{key}", {
		params: { path: { key } },
	});
	if (result.error !== undefined) {
		unwrap(result);
	}
}

export async function listInstances() {
	return unwrap(await api.GET("/admin/extensions/instances")).data;
}

export async function createInstance(body: InstanceInput) {
	return unwrap(
		await api.POST("/admin/extensions/instances", { body: body as never }),
	).data;
}

export async function updateInstance(
	id: string,
	body: Omit<Partial<InstanceInput>, "id">,
) {
	return unwrap(
		await api.PATCH("/admin/extensions/instances/{id}", {
			params: { path: { id } },
			body: body as never,
		}),
	).data;
}

export async function deleteInstance(id: string): Promise<void> {
	const result = await api.DELETE("/admin/extensions/instances/{id}", {
		params: { path: { id } },
	});
	if (result.error !== undefined) {
		unwrap(result);
	}
}

/** Clears a breaker trip in the replica answering this request. */
export async function resetInstance(id: string) {
	return unwrap(
		await api.POST("/admin/extensions/{id}/reset", {
			params: { path: { id } },
		}),
	).data;
}
