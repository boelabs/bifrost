import type { components } from "#/shared/api/schema";
import { api, unwrap } from "#/shared/api/client.ts";

import type {
	DashboardSettingsPatch,
	RouterSettingsPatch,
	FallbackPolicy,
} from "./common.ts";

export async function routerSettings() {
	return unwrap(await api.GET("/admin/router-settings")).data;
}

export async function updateRouterSettings(body: RouterSettingsPatch) {
	return unwrap(await api.PUT("/admin/router-settings", { body })).data;
}

export async function listFallbacks() {
	return unwrap(await api.GET("/admin/fallbacks")).data;
}

export async function upsertFallback(body: components["schemas"]["Fallback"]) {
	return unwrap(await api.PUT("/admin/fallbacks", { body })).data;
}

export async function deleteFallback(
	primaryModel: string,
	reason: FallbackPolicy["reason"],
): Promise<void> {
	const result = await api.DELETE("/admin/fallbacks/{primaryModel}/{reason}", {
		params: { path: { primaryModel, reason } },
	});
	if (result.error !== undefined) unwrap(result);
}

export async function clearCache(params?: {
	callType?: string;
	namespace?: string;
}) {
	return unwrap(await api.DELETE("/admin/cache", { params: { query: params } }))
		.data;
}

export async function dashboardSettings() {
	return unwrap(await api.GET("/admin/dashboard-settings")).data;
}

export async function updateDashboardSettings(body: DashboardSettingsPatch) {
	return unwrap(await api.PUT("/admin/dashboard-settings", { body })).data;
}
