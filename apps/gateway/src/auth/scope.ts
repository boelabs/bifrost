import { GatewayError } from "#core/errors.ts";
import type { Auth } from "./types.ts";

/**
 * Checks that the credential may use a public model.
 *  - master: everything.
 *  - virtual with allowedModels=[]: everything.
 *  - virtual with allowedModels=[...]: only the listed ones.
 * Throws GatewayError(permission) otherwise.
 */
export function assertModelAllowed(auth: Auth, publicModel: string): void {
	if (auth.type === "master") return;
	const allowed = auth.key.allowedModels;
	if (allowed.length === 0) return;
	if (!allowed.includes(publicModel)) {
		throw new GatewayError({
			class: "permission",
			message: `The API key does not have access to public model "${publicModel}"`,
		});
	}
}
