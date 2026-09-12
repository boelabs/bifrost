import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Context } from "hono";

/**
 * SINGLE envelope for the gateway's MANAGEMENT API responses (/admin/*) and any of our own
 * (non-inference) endpoints. Convention:
 *   - success -> { "data": <payload> }   (object or array)
 *   - error   -> { "error": {...} }       (formatted by onError with GatewayError.toOpenAI)
 *   - delete  -> 204 with no body
 *
 * INFERENCE endpoints (/v1/chat/completions, /v1/responses) do NOT use this: they follow the exact
 * OpenAI/OpenResponses contract. This consistency improves DX (a single shape to learn) without
 * coupling the logic to Hono beyond this helper.
 */
export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
	return c.json({ data }, status);
}

export interface PaginationMeta {
	limit: number;
	offset: number;
	total: number;
	nextOffset: number | null;
}

export function paginated<T>(
	c: Context,
	data: T[],
	pagination: PaginationMeta,
	status: ContentfulStatusCode = 200,
) {
	return c.json({ data, pagination }, status);
}
