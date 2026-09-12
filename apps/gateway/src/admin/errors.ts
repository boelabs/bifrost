import { GatewayError } from "#core/errors.ts";

/**
 * Classes whose detail describes the CALLER'S OWN input: a malformed body, a field that fails
 * validation, an id that does not exist, a permission they lack. Anything else keeps the generic
 * public message — a `server` or `timeout` detail can carry internal wording that is nobody's
 * business.
 */
const TRANSPARENT = new Set(["bad_request", "not_found", "permission"]);

/** The management surface: /admin/* and the operator session routes. */
export function isManagementPath(path: string): boolean {
	return path.startsWith("/admin") || path.startsWith("/auth");
}

/**
 * Publishes a configuration error's real reason on the management API.
 *
 * `GatewayError` deliberately defaults `publicMessage` to a generic sentence per class, because on the
 * inference path we are a router: the same public model resolves to different deployments, each fails
 * differently, and the client must get a stable error that does not leak a provider's wording.
 *
 * That reasoning does not reach the management API. The caller is an authenticated operator, the
 * subject is the configuration they just sent, and `"The request is invalid."` with a `param` is
 * strictly less useful than naming the unregistered adapter or the missing field. Nothing is disclosed
 * that the caller did not write.
 *
 * This lives in the error handler rather than at each `throw` because Hono resolves errors centrally —
 * a `try/catch` around `next()` never sees them — and because a new admin route should not have to
 * remember: the deployment service alone raises a dozen configuration errors, and only two set a
 * public message.
 */
export function publicizeManagementError(error: GatewayError): GatewayError {
	if (!TRANSPARENT.has(error.class)) return error;
	// Already explicit: keep whatever the thrower chose to publish.
	if (error.publicMessage === error.message) return error;
	return new GatewayError({
		class: error.class,
		message: error.message,
		publicMessage: error.message,
		status: error.httpStatus,
		code: error.code,
		param: error.param,
		...(error.headers ? { headers: error.headers } : {}),
		cause: error,
	});
}
