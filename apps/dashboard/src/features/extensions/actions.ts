"use server";

import type { InstanceInput } from "./common.ts";
import { attempt } from "#/shared/lib/action.ts";
import { revalidatePath } from "next/cache";

import {
	listArtifactVersions,
	activateArtifact,
	createInstance,
	deleteArtifact,
	deleteInstance,
	updateInstance,
	uploadArtifact,
	resetInstance,
} from "./api.ts";

/**
 * Every write the extensions page can make.
 *
 * These are the highest-privilege calls in the dashboard — uploading an artifact puts new code in
 * the gateway's request path — which is exactly why they run on the server, against a session the
 * gateway has already scoped to an owner.
 */
const PAGE = "/extensions";

export async function uploadArtifactAction(body: {
	key: string;
	code: string;
}) {
	const result = await attempt(
		() => uploadArtifact(body),
		"The module could not be uploaded.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

export async function activateArtifactAction(key: string, version: number) {
	const result = await attempt(
		() => activateArtifact(key, version),
		"The version could not be activated.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

export async function deleteArtifactAction(key: string) {
	const result = await attempt(
		() => deleteArtifact(key),
		"The module could not be deleted.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

export async function saveInstanceAction(
	body: InstanceInput,
	existingId?: string,
) {
	const result = await attempt(
		() =>
			existingId ? updateInstance(existingId, body) : createInstance(body),
		"The instance could not be saved.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

export async function deleteInstanceAction(id: string) {
	const result = await attempt(
		() => deleteInstance(id),
		"The instance could not be deleted.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

/**
 * Resets the breaker in the replica answering this request — not in the database, and not in any
 * other replica. Revalidated so the status column reflects it immediately.
 */
export async function resetInstanceAction(id: string) {
	const result = await attempt(
		() => resetInstance(id),
		"The instance could not be reset.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

/** Read on demand, when someone expands the version list for one module. */
export async function loadArtifactVersionsAction(key: string) {
	return attempt(
		() => listArtifactVersions(key),
		"The versions could not be loaded.",
	);
}
