"use server";

import { attempt } from "#/shared/lib/action.ts";
import { payloadSample } from "./api.ts";

/**
 * Reading a retained payload is itself audited by the gateway, which is why it is a separate action
 * behind a separate click on the operation's page — opening a log must not silently produce an
 * access record for content nobody asked to see.
 *
 * It is a Server Action rather than a browser fetch for the same reason every mutation is: the
 * gateway call belongs on the server, where the session cookie is relayed and the CSRF token is
 * added without the page having to know either exists.
 */
export async function loadPayloadSample(id: string) {
	return attempt(
		() => payloadSample(id),
		"No retained payload for this operation.",
	);
}
