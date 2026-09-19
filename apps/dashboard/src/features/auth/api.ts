import { api, unwrap } from "#/shared/api/client.ts";
import type { OperatorIdentity } from "./common.ts";

/**
 * Server-side reads of the operator's own session. Sign-in and sign-out are deliberately not here —
 * see `./browser.ts` for why they stay in the browser.
 */

/**
 * The current identity, or null when there is no live session.
 *
 * A 401 or 403 is an answer, not a failure: it is how the gate in `app/(dash)/layout.tsx` learns to
 * send the visitor to the login screen, so it must not throw.
 */
export async function currentSession(): Promise<OperatorIdentity | null> {
	const result = await api.GET("/auth/session", {});
	if (result.response.status === 401 || result.response.status === 403) {
		return null;
	}
	return unwrap(result).data;
}

/**
 * The same question, for the one page that must render whether or not the gateway answers.
 *
 * `currentSession()` rejects when the gateway is unreachable, which is right for the authenticated
 * half: an outage must not be mistaken for a signed-out operator. The login screen is the exception.
 * It asks only so that someone already signed in is not left staring at a form, and it is the one
 * page that has to survive a gateway that is down — refusing to paint it would hide the very screen
 * an operator reaches for during an outage. Unreachable means "cannot tell", and the form is the
 * honest answer to that.
 */
export async function currentSessionIfReachable(): Promise<OperatorIdentity | null> {
	try {
		return await currentSession();
	} catch {
		return null;
	}
}

export async function dashboardConfig() {
	return unwrap(await api.GET("/auth/config")).data;
}
