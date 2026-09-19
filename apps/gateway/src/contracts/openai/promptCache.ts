import { GatewayError } from "#core/errors.ts";
import { z } from "zod/v4";

import type {
	CanonicalChatRequest,
	CanonicalContentPart,
} from "#core/canonical.ts";

export const promptCacheOptionsSchema = z
	.object({
		mode: z.enum(["implicit", "explicit"]).optional(),
		ttl: z.literal("30m").optional(),
	})
	.strict();
export const promptCacheRetentionSchema = z
	.enum(["in_memory", "24h"])
	.nullable();
export const promptCacheBreakpointSchema = z
	.object({ mode: z.literal("explicit") })
	.strict();

function parseCacheControl<T>(
	schema: z.ZodType<T>,
	value: unknown,
	param: string,
): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		throw new GatewayError({
			class: "bad_request",
			code: "invalid_parameter",
			param,
			message: `Invalid ${param}: ${parsed.error.issues[0]?.message ?? "invalid cache control"}`,
		});
	}
	return parsed.data;
}

/** Accept the former escape hatch, but never let it override the public control. */
export function normalizePromptCacheRequest<
	T extends {
		prompt_cache_options?: z.infer<typeof promptCacheOptionsSchema> | undefined;
		prompt_cache_retention?:
			| z.infer<typeof promptCacheRetentionSchema>
			| undefined;
		extra_body?: Record<string, unknown> | undefined;
		providerOptions?: Record<string, unknown> | undefined;
	},
>(request: T): T {
	const result = { ...request };
	if (request.providerOptions !== undefined) {
		if (request.extra_body?.providerOptions !== undefined) {
			throw new GatewayError({
				class: "bad_request",
				code: "invalid_extra_body",
				param: "extra_body.providerOptions",
				message: "Duplicate providerOptions",
			});
		}
		result.extra_body = {
			...request.extra_body,
			providerOptions: request.providerOptions,
		};
	}
	if (!result.extra_body) {
		return result;
	}
	const extra = { ...result.extra_body };
	for (const key of [
		"prompt_cache_options",
		"prompt_cache_retention",
	] as const) {
		if (!(key in extra)) {
			continue;
		}
		if (request[key] !== undefined) {
			throw new GatewayError({
				class: "bad_request",
				code: "invalid_extra_body",
				param: `extra_body.${key}`,
				message: `extra_body.${key} collides with the public request parameter`,
			});
		}
		if (key === "prompt_cache_options") {
			result.prompt_cache_options = parseCacheControl(
				promptCacheOptionsSchema,
				extra[key],
				`extra_body.${key}`,
			);
		} else {
			result.prompt_cache_retention = parseCacheControl(
				promptCacheRetentionSchema,
				extra[key],
				`extra_body.${key}`,
			);
		}
		delete extra[key];
	}
	result.extra_body = extra;
	return result;
}

export function readPromptCachePolicy(
	request: {
		prompt_cache_options?: z.infer<typeof promptCacheOptionsSchema> | undefined;
		prompt_cache_retention?:
			| z.infer<typeof promptCacheRetentionSchema>
			| undefined;
	},
	canonical: CanonicalChatRequest,
): void {
	if (request.prompt_cache_options !== undefined) {
		canonical.promptCachePolicy = {
			...(request.prompt_cache_options.mode === undefined
				? {}
				: { mode: request.prompt_cache_options.mode }),
			...(request.prompt_cache_options.ttl === undefined
				? {}
				: { minimumTtlSeconds: 1800 }),
		};
	}
	if (request.prompt_cache_retention !== undefined) {
		canonical.promptCacheRetention =
			request.prompt_cache_retention === null
				? null
				: request.prompt_cache_retention === "24h"
					? "extended"
					: "memory";
	}
}

export function writePromptCachePolicy(
	request: CanonicalChatRequest,
): Record<string, unknown> {
	const ttl = request.promptCachePolicy?.minimumTtlSeconds;
	if (ttl !== undefined && ttl !== 1800) {
		throw new GatewayError({
			class: "bad_request",
			code: "unsupported_parameter",
			param: "prompt_cache_options.ttl",
			message: "This transport only supports a 30m minimum cache lifetime",
			deploymentHealth: "neutral",
		});
	}
	return {
		...(request.promptCachePolicy === undefined
			? {}
			: {
					prompt_cache_options: {
						...(request.promptCachePolicy.mode === undefined
							? {}
							: { mode: request.promptCachePolicy.mode }),
						...(request.promptCachePolicy.minimumTtlSeconds === undefined
							? {}
							: { ttl: "30m" }),
					},
				}),
		...(request.promptCacheRetention === undefined
			? {}
			: {
					prompt_cache_retention:
						request.promptCacheRetention === null
							? null
							: request.promptCacheRetention === "extended"
								? "24h"
								: "in_memory",
				}),
	};
}

export function readCacheBreakpoint<T extends CanonicalContentPart | null>(
	part: Record<string, unknown>,
	canonical: T,
): T {
	if (part.prompt_cache_breakpoint !== undefined) {
		parseCacheControl(
			promptCacheBreakpointSchema,
			part.prompt_cache_breakpoint,
			"prompt_cache_breakpoint",
		);
		if (canonical !== null) {
			canonical.cacheBreakpoint = true;
		}
	}
	return canonical;
}

export function writeCacheBreakpoint(
	part: CanonicalContentPart,
): Record<string, unknown> {
	return part.cacheBreakpoint
		? { prompt_cache_breakpoint: { mode: "explicit" } }
		: {};
}
