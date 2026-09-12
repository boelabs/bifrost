"use server";

import { attempt } from "#/shared/lib/action.ts";
import { revalidatePath } from "next/cache";
import type { Role } from "./common.ts";

import {
	listSessions,
	setPassword,
	createUser,
	deleteUser,
	updateUser,
} from "./api.ts";

/** Every write the users page can make, plus the one read it performs on demand. */
const PAGE = "/users";

export async function createUserAction(
	body: {
		username: string;
		password: string;
		role: Role;
		mustChangePassword?: boolean;
	},
	idempotencyKey?: string,
) {
	const result = await attempt(
		() => createUser(body, idempotencyKey),
		"The operator could not be created.",
	);
	if (result.ok) revalidatePath(PAGE);
	return result;
}

export async function updateUserAction(
	id: string,
	body: { role?: Role; enabled?: boolean; mustChangePassword?: boolean },
) {
	const result = await attempt(
		() => updateUser(id, body),
		"The account could not be updated.",
	);
	if (result.ok) revalidatePath(PAGE);
	return result;
}

export async function setPasswordAction(id: string, password: string) {
	const result = await attempt(
		() => setPassword(id, password),
		"The password could not be set.",
	);
	if (result.ok) revalidatePath(PAGE);
	return result;
}

export async function deleteUserAction(id: string) {
	const result = await attempt(
		() => deleteUser(id),
		"The operator could not be deleted.",
	);
	if (result.ok) revalidatePath(PAGE);
	return result;
}

/** Read on demand, when an owner opens the sessions dialog for one account. */
export async function loadSessionsAction(id: string) {
	return attempt(() => listSessions(id), "The sessions could not be loaded.");
}
