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
}) {
	return unwrap(await api.GET("/admin/keys", { params: { query: params } }));
}

/** The admin API's largest page. */
const SCAN_LIMIT = 200;

/**
 * One key, for its own page.
 *
 * Until the gateway serves `GET /admin/keys/{id}`, the key is found in the list, a page at a time.
 * `null` when no key has that id.
 */
export async function getKey(id: string): Promise<VirtualKey | null> {
	let offset: number | null = 0;
	while (offset !== null) {
		const { data, pagination } = await listKeys({ limit: SCAN_LIMIT, offset });
		const found = data.find((key) => key.id === id);
		if (found) {
			return found;
		}
		offset = pagination.nextOffset;
	}
	return null;
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
