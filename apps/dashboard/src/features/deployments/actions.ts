"use server";

import { deleteDeployment, saveDeployment, updateDeployment } from "./api.ts";
import type { CreateDeploymentInput } from "./common.ts";
import { attempt } from "#/shared/lib/action.ts";
import { revalidatePath } from "next/cache";

/**
 * Every write the models page can make.
 *
 * Deployment credentials pass through here, which is the strongest reason for these to be Server
 * Actions: an API key the operator pastes goes straight from this process to the gateway, and never
 * ends up in a request the browser composed.
 */
const PAGE = "/models";

export async function saveDeploymentAction(
	body: CreateDeploymentInput,
	existingId?: string,
	idempotencyKey?: string,
) {
	const result = await attempt(
		() => saveDeployment(body, existingId, idempotencyKey),
		"The deployment could not be saved.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

export async function toggleDeploymentAction(id: string, enabled: boolean) {
	const result = await attempt(
		() => updateDeployment(id, { enabled }),
		"The deployment could not be updated.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

export async function deleteDeploymentAction(id: string) {
	const result = await attempt(
		() => deleteDeployment(id),
		"The deployment could not be deleted.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}
