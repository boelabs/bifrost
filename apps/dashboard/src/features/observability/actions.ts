"use server";

import { operationDetail, payloadSample } from "./api.ts";
import { attempt } from "#/shared/lib/action.ts";

/**
 * The two reads the log table performs on demand, when an operator opens a row.
 *
 * They are Server Actions rather than browser fetches for the same reason every mutation is: the
 * gateway call belongs on the server, where the session cookie is relayed and the CSRF token is
 * added without the page having to know either exists.
 */

export async function loadOperationDetail(id: string) {
	return attempt(
		() => operationDetail(id),
		"The operation could not be loaded.",
	);
}

/**
 * Reading a retained payload is itself audited by the gateway, which is why it is a separate action
 * behind a separate click — opening a log must not silently produce an access record for content
 * nobody asked to see.
 */
export async function loadPayloadSample(id: string) {
	return attempt(
		() => payloadSample(id),
		"No retained payload for this operation.",
	);
}
