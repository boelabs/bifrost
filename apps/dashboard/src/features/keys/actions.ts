"use server";

import type { CreateKeyInput, UpdateKeyInput } from "./common.ts";
import { createKey, deleteKey, updateKey } from "./api.ts";
import { attempt } from "#/shared/lib/action.ts";
import { revalidatePath } from "next/cache";

/**
 * Every write the keys page can make.
 *
 * They run on the server so the session cookie and the CSRF token the gateway demands are added in
 * one place (`shared/api/client.ts`) rather than assembled by the page, and they return the outcome
 * instead of throwing it — see `shared/lib/action.ts` for why.
 *
 * `revalidatePath` is what replaces the old manual refetch: the response to the action already
 * carries the re-rendered table, so the row an operator just changed is the gateway's version of it
 * by the time the click finishes.
 */
const PAGE = "/keys";

export async function createKeyAction(
	body: CreateKeyInput,
	idempotencyKey?: string,
) {
	const result = await attempt(
		() => createKey(body, idempotencyKey),
		"The key could not be created.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

export async function updateKeyAction(id: string, body: UpdateKeyInput) {
	const result = await attempt(
		() => updateKey(id, body),
		"The key could not be updated.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}

export async function deleteKeyAction(id: string) {
	const result = await attempt(
		() => deleteKey(id),
		"The key could not be deleted.",
	);
	if (result.ok) {
		revalidatePath(PAGE);
	}
	return result;
}
