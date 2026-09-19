"use server";

import type { components } from "#/shared/api/schema";
import { attempt } from "#/shared/lib/action.ts";
import { revalidatePath } from "next/cache";

import {
	updateDashboardSettings,
	updateRouterSettings,
	deleteFallback,
	upsertFallback,
	clearCache,
} from "./api.ts";

import type {
	DashboardSettingsPatch,
	RouterSettingsPatch,
	FallbackPolicy,
} from "./common.ts";

/** Every write the settings page can make. */
const PAGE = "/settings";

export async function saveRouterSettingsAction(body: RouterSettingsPatch) {
	const result = await attempt(
		() => updateRouterSettings(body),
		"The router settings could not be saved.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

export async function saveFallbackAction(
	body: components["schemas"]["Fallback"],
) {
	const result = await attempt(
		() => upsertFallback(body),
		"The chain could not be saved.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

export async function deleteFallbackAction(
	primaryModel: string,
	reason: FallbackPolicy["reason"],
) {
	const result = await attempt(
		() => deleteFallback(primaryModel, reason),
		"The chain could not be removed.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

/**
 * Not revalidated on purpose: clearing the cache changes nothing this page displays, and the count
 * it returns is the whole answer.
 */
export async function clearCacheAction() {
	return attempt(() => clearCache(), "The cache could not be cleared.");
}

export async function saveDashboardSettingsAction(
	body: DashboardSettingsPatch,
) {
	const result = await attempt(
		() => updateDashboardSettings(body),
		"The session policy could not be saved.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}
