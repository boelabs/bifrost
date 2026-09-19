import type { CanonicalChatRequest } from "./canonical.ts";
import { GatewayError } from "./errors.ts";

/** A native cache policy must never disappear during protocol conversion. */
/** The cache control this request carries, named as the client wrote it. */
function prefixCacheParam(request: CanonicalChatRequest): string | undefined {
	if (request.promptCachePolicy !== undefined) {
		return "prompt_cache_options";
	}
	if (request.promptCacheRetention !== undefined) {
		return "prompt_cache_retention";
	}
	const breakpointed = request.messages.some(
		(message) =>
			Array.isArray(message.content) &&
			message.content.some((part) => part.cacheBreakpoint),
	);
	return breakpointed ? "prompt_cache_breakpoint" : undefined;
}

export function assertNoPrefixCachePolicy(request: CanonicalChatRequest): void {
	const param = prefixCacheParam(request);
	if (param !== undefined) {
		throw new GatewayError({
			class: "bad_request",
			code: "unsupported_parameter",
			param,
			deploymentHealth: "neutral",
			message: `The selected provider transport cannot preserve ${param}`,
		});
	}
}
