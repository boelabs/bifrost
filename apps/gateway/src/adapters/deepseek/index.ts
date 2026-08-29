import type { CanonicalChatRequest } from "#core/canonical.ts";
import type { ProviderModule } from "#adapters/types.ts";
import { GatewayError } from "#core/errors.ts";

import {
	makeOpenAIStyleAdapter,
	contextWindowRefine,
} from "#adapters/openaiStyle.ts";

function usesStrictTools(req: CanonicalChatRequest): boolean {
	return req.tools?.some((tool) => tool.strict === true) === true;
}

function usesStrictOutput(req: CanonicalChatRequest): boolean {
	return (
		req.responseFormat?.type === "json_schema" &&
		req.responseFormat.strict === true
	);
}

function usesSchemaOutput(req: CanonicalChatRequest): boolean {
	return req.responseFormat?.type === "json_schema";
}

function assertDeepSeekStrictRequest(
	req: CanonicalChatRequest,
	ctx: { transport: string },
): void {
	const strictTools = usesStrictTools(req);
	const strictOutput = usesStrictOutput(req);
	if (strictTools && strictOutput) {
		throw new GatewayError({
			class: "bad_request",
			deploymentHealth: "neutral",
			message:
				"DeepSeek cannot combine strict tools with strict output schemas in one request",
			code: "incompatible_strict_modes",
			param: "response_format",
		});
	}
	if (strictTools && req.tools?.some((tool) => tool.strict !== true)) {
		throw new GatewayError({
			class: "bad_request",
			deploymentHealth: "neutral",
			message: "DeepSeek strict mode requires every tool to set strict to true",
			code: "strict_tools_require_all",
			param: "tools",
		});
	}
	if (strictTools && ctx.transport !== "chat_completions") {
		throw new GatewayError({
			class: "bad_request",
			deploymentHealth: "neutral",
			message: "DeepSeek strict tools require the Chat Completions transport",
			code: "strict_tools_transport_conflict",
			param: "tools",
		});
	}
	if (usesSchemaOutput(req) && ctx.transport !== "responses") {
		throw new GatewayError({
			class: "bad_request",
			deploymentHealth: "neutral",
			message: "DeepSeek strict output schemas require the Responses transport",
			code: "strict_output_transport_conflict",
			param: "response_format",
		});
	}
}

function prepareDeepSeekRequest(
	req: CanonicalChatRequest,
	ctx: { transport: string },
): CanonicalChatRequest {
	if (ctx.transport !== "responses") return req;
	// DeepSeek's Responses schema is inherently strict and its format/tool objects do not
	// expose OpenAI's optional `strict` members. Strip those markers after validation so the
	// upstream receives its native shape while the gateway still enforces the requested guarantee.
	const format = req.responseFormat;
	const responseFormat =
		format?.type === "json_schema"
			? (() => {
					const { strict: _strict, ...withoutStrict } = format;
					return withoutStrict;
				})()
			: format;
	const tools = req.tools?.map((tool) => {
		const { strict: _strict, ...rest } = tool;
		return rest;
	});
	if (responseFormat === req.responseFormat && tools === undefined) return req;
	return {
		...req,
		...(responseFormat !== undefined ? { responseFormat } : {}),
		...(tools !== undefined ? { tools } : {}),
	};
}

/**
 * DeepSeek documents one base host with per-feature prefixes: `/beta` gates strict tools, while the
 * Responses API is only documented at the bare host — `/v1` is an OpenAI-SDK alias demonstrated for
 * Chat Completions alone. Rewrite only the prefixes DeepSeek itself owns, and leave a custom base URL
 * (a proxy or gateway) untouched.
 */
function deepSeekChatBaseUrl(
	baseUrl: string,
	req: CanonicalChatRequest,
	ctx: { transport: string },
): string {
	const prefix = usesStrictTools(req)
		? "/beta"
		: ctx.transport === "responses"
			? ""
			: undefined;
	if (prefix === undefined) return baseUrl;
	const url = new URL(baseUrl);
	if (
		url.hostname.toLowerCase() !== "api.deepseek.com" ||
		(url.pathname !== "/v1" && url.pathname !== "/" && url.pathname !== "/beta")
	)
		return baseUrl;
	url.pathname = prefix;
	return url.toString().replace(/\/+$/, "");
}

/**
 * DeepSeek (api.deepseek.com). OpenAI-compatible API (chat/completions). V4 declares top-level
 * thinking and `reasoning_effort` high/max from the catalog.
 */
export const deepseekAdapter = makeOpenAIStyleAdapter({
	key: "deepseek",
	label: "DeepSeek",
	defaultBaseUrl: "https://api.deepseek.com/v1",
	defaultTransport: "chat_completions",
	supportedChatTransports: ["chat_completions", "responses"],
	maxTokensField: "max_tokens",
	supportsTopK: true,
	refineBadRequest: contextWindowRefine,
	preferredChatTransport(req, ctx) {
		if (usesStrictTools(req)) return "chat_completions";
		if (usesSchemaOutput(req)) return "responses";
		return ctx.nativeTransport === "responses" &&
			ctx.upstreamModel.toLowerCase().startsWith("deepseek-v4-")
			? "responses"
			: "chat_completions";
	},
	assertChatRequestSupported: assertDeepSeekStrictRequest,
	prepareChatRequest: prepareDeepSeekRequest,
	resolveChatBaseUrl: deepSeekChatBaseUrl,
});

export const deepseekProvider: ProviderModule = { adapter: deepseekAdapter };
