import { GatewayError } from "#core/errors.ts";

/**
 * Base shape of an adapter's credentials. Each adapter extends it with its own fields (organization,
 * version, etc.). `credentials` arrives as an already-decrypted `Record<string, unknown>`; these
 * helpers validate it and narrow it to a concrete type in a single place.
 */
export interface BaseCreds {
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
}

/**
 * Reads the credentials requiring `apiKey`. Throws `GatewayError(auth)` with the provider's `label`
 * if missing. Returns the object narrowed to `T` with `apiKey` guaranteed as a string.
 */
export function requireApiKeyCreds<T extends BaseCreds>(
	credentials: unknown,
	label: string,
): T & { apiKey: string } {
	const c = (credentials ?? {}) as T;
	if (!c.apiKey) {
		throw new GatewayError({
			class: "auth",
			message: `${label}: missing 'apiKey' in credentials`,
		});
	}
	return c as T & { apiKey: string };
}
