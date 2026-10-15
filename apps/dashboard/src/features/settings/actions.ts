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

/** Every section of Settings hangs off this layout, so one revalidation covers them all. */
const SETTINGS = "/settings";

export async function saveRouterSettingsAction(body: RouterSettingsPatch) {
	const result = await attempt(
		() => updateRouterSettings(body),
		"The router settings could not be saved.",
	);
	if (result.ok) {
		revalidatePath(SETTINGS, "layout");
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
		revalidatePath(SETTINGS, "layout");
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
		revalidatePath(SETTINGS, "layout");
	}
	return result;
}

/**
 * Not revalidated on purpose: clearing the cache changes nothing Settings displays, and the count
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
		revalidatePath(SETTINGS, "layout");
	}
	return result;
}
