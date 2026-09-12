import { GatewayError } from "#core/errors.ts";
import type { Auth } from "./types.ts";

/**
 * Checks that the credential may use a public model.
 *  - master: everything.
 *  - session: everything its role can reach; model scoping is a property of issued keys, not of
 *    operators, and an operator can read the whole catalog from /admin anyway.
 *  - virtual with allowedModels=[]: everything.
 *  - virtual with allowedModels=[...]: only the listed ones.
 * Throws GatewayError(permission) otherwise.
 */
export function assertModelAllowed(auth: Auth, publicModel: string): void {
	if (auth.type === "master" || auth.type === "session") return;
	const allowed = auth.key.allowedModels;
	if (allowed.length === 0) return;
	if (!allowed.includes(publicModel)) {
		throw new GatewayError({
			class: "permission",
			message: `The API key does not have access to public model "${publicModel}"`,
		});
	}
}
