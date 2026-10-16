import { api, unwrap } from "#/shared/api/client.ts";

import type {
	CreatedVirtualKey,
	CreateKeyInput,
	UpdateKeyInput,
	VirtualKey,
} from "./common.ts";

export async function listKeys(params?: {
	limit?: number;
	offset?: number;
	q?: string;
	enabled?: boolean;
}) {
	return unwrap(await api.GET("/admin/keys", { params: { query: params } }));
}

/** One key, for its own page, never its secret; `null` when no key has that id. */
export async function getKey(id: string): Promise<VirtualKey | null> {
	const result = await api.GET("/admin/keys/{id}", {
		params: { path: { id } },
	});
	if (result.response.status === 404) {
		return null;
	}
	return unwrap(result).data;
}

/**
 * The plaintext key comes back exactly once, here.
 *
 * `idempotencyKey` is what makes a retry safe: without it, a create that timed out after the gateway
 * had already issued the key leaves an operator with a second key they never wanted and a secret they
 * never saw.
 */
export async function createKey(
	body: CreateKeyInput,
	idempotencyKey?: string,
): Promise<CreatedVirtualKey> {
	return unwrap(
		await api.POST("/admin/keys", {
			body,
			...(idempotencyKey
				? { headers: { "Idempotency-Key": idempotencyKey } }
				: {}),
		}),
	).data;
}

export async function updateKey(
	id: string,
	body: UpdateKeyInput,
): Promise<VirtualKey> {
	return unwrap(
		await api.PATCH("/admin/keys/{id}", { params: { path: { id } }, body }),
	).data;
}

export async function deleteKey(id: string): Promise<void> {
	const result = await api.DELETE("/admin/keys/{id}", {
		params: { path: { id } },
	});
	if (result.error !== undefined) {
		unwrap(result);
	}
}
