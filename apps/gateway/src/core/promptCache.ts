import type { CanonicalChatRequest } from "./canonical.ts";
import { GatewayError } from "./errors.ts";

/** A native cache policy must never disappear during protocol conversion. */
export function assertNoPrefixCachePolicy(request: CanonicalChatRequest): void {
	const param =
		request.promptCachePolicy === undefined
			? request.promptCacheRetention === undefined
				? request.messages.some(
						(message) =>
							Array.isArray(message.content) &&
							message.content.some((part) => part.cacheBreakpoint),
					)
					? "prompt_cache_breakpoint"
					: undefined
				: "prompt_cache_retention"
			: "prompt_cache_options";
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
