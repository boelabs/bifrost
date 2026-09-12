import { api, unwrap } from "#/shared/api/client.ts";
import type { Role } from "./common.ts";

export async function listUsers(params?: {
	limit?: number;
	offset?: number;
	role?: Role;
	q?: string;
}) {
	return unwrap(await api.GET("/admin/users", { params: { query: params } }));
}

export async function createUser(
	body: {
		username: string;
		password: string;
		role: Role;
		mustChangePassword?: boolean;
	},
	idempotencyKey?: string,
) {
	return unwrap(
		await api.POST("/admin/users", {
			body,
			...(idempotencyKey
				? { headers: { "Idempotency-Key": idempotencyKey } }
				: {}),
		}),
	).data;
}

export async function updateUser(
	id: string,
	body: { role?: Role; enabled?: boolean; mustChangePassword?: boolean },
) {
	return unwrap(
		await api.PATCH("/admin/users/{id}", { params: { path: { id } }, body }),
	).data;
}

export async function setPassword(
	id: string,
	password: string,
	mustChangePassword = true,
): Promise<void> {
	const result = await api.POST("/admin/users/{id}/password", {
		params: { path: { id } },
		body: { password, mustChangePassword },
	});
	if (result.error !== undefined) unwrap(result);
}

export async function deleteUser(id: string): Promise<void> {
	const result = await api.DELETE("/admin/users/{id}", {
		params: { path: { id } },
	});
	if (result.error !== undefined) unwrap(result);
}

export async function listSessions(id: string) {
	return unwrap(
		await api.GET("/admin/users/{id}/sessions", { params: { path: { id } } }),
	).data;
}
