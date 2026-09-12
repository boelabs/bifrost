import type { OperatorIdentity } from "./common.ts";
import { redirect } from "next/navigation";
import { currentSession } from "./api.ts";

/**
 * The authenticated layout's single question: who is this?
 *
 * `src/proxy.ts` already turned away anyone without a session cookie, so reaching here without an
 * identity means the cookie is stale or the gateway revoked the session — the same answer either
 * way, back to the login screen.
 *
 * Deliberately *not* cached. `use cache: private` would let this ride along in the App Shell and
 * paint the sidebar before the network answers, but it would also keep an operator's permissions in
 * their browser after a role change. The gateway is the authority on what someone may do, and this
 * asks it on every render.
 */
export async function requireIdentity(): Promise<OperatorIdentity> {
	const identity = await currentSession();
	if (!identity) redirect("/auth");
	return identity;
}
