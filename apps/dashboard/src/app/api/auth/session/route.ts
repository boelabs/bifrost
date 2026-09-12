import { relay } from "#/shared/api/relay.ts";

/**
 * Sign-in and sign-out.
 *
 * These are the two calls that cannot be a Server Action: the gateway answers them with
 * `Set-Cookie`, and the session cookie is httpOnly, so the browser's own request has to receive it.
 * Relaying through this route puts that cookie on the dashboard's domain.
 */
export function POST(request: Request): Promise<Response> {
	return relay(request, "/auth/session");
}

export function DELETE(request: Request): Promise<Response> {
	return relay(request, "/auth/session");
}
