import { relay } from "#/shared/api/relay.ts";

/**
 * The playground's inference, relayed.
 *
 * Inference arrives token by token, so this is the one browser call that could not go through a
 * Server Action — those buffer. `relay` passes the body through unread, which keeps it streaming.
 */
async function handler(
	request: Request,
	context: RouteContext<"/api/v1/[...path]">,
): Promise<Response> {
	const { path } = await context.params;
	return relay(request, `/v1/${path.join("/")}`);
}

export { handler as GET, handler as POST };
