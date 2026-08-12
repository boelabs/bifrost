import { looksLikeContextWindowError } from "#core/httpError.ts";
import { GatewayError, type ErrorClass } from "#core/errors.ts";

import {
	makeOpenAIStyleAdapter,
	type OpenAIStyleConfig,
} from "./openaiStyle.ts";

/**
 * Accepts the resource endpoint or the full v1 base. Never allows legacy deployment routes or
 * api-version query params: Azure v1 fixes the contract at /openai/v1.
 */
export function normalizeAzurev1BaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new GatewayError({
			class: "bad_request",
			message: "Azure v1: credentials.baseUrl must be a valid URL",
		});
	}
	if (url.protocol !== "https:") {
		throw new GatewayError({
			class: "bad_request",
			message: "Azure v1: credentials.baseUrl must use HTTPS",
		});
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new GatewayError({
			class: "bad_request",
			message:
				"Azure v1: credentials.baseUrl cannot contain credentials, query parameters, or fragments",
		});
	}

	const path = url.pathname.replace(/\/+$/, "");
	if (
		/\/openai\/deployments(?:\/|$)/i.test(path) ||
		/\/deployments(?:\/|$)/i.test(path)
	) {
		throw new GatewayError({
			class: "bad_request",
			message:
				"Azure v1: deployment-based URLs are legacy; provide the resource endpoint or /openai/v1",
		});
	}
	if (path === "" || path === "/") url.pathname = "/openai/v1";
	else if (path.toLowerCase() === "/openai/v1") url.pathname = "/openai/v1";
	else {
		throw new GatewayError({
			class: "bad_request",
			message:
				"Azure v1: credentials.baseUrl must be the resource endpoint or end in /openai/v1",
		});
	}
	return url.toString().replace(/\/+$/, "");
}

export function azureRefineBadRequest(
	message: string,
	body: unknown,
): ErrorClass | null {
	const error = (
		body as { error?: { code?: string; innererror?: { code?: string } } }
	)?.error;
	const code = error?.innererror?.code ?? error?.code;
	if (
		code === "context_length_exceeded" ||
		looksLikeContextWindowError(message)
	) {
		return "context_window";
	}
	if (
		[
			"content_filter",
			"content_policy_violation",
			"ResponsibleAIPolicyViolation",
		].includes(code ?? "")
	) {
		return "content_policy";
	}
	return null;
}

export function makeAzurev1Adapter(
	config: Pick<
		OpenAIStyleConfig,
		| "key"
		| "label"
		| "defaultTransport"
		| "supportedChatTransports"
		| "contentInputs"
		| "embeddings"
	>,
) {
	return makeOpenAIStyleAdapter({
		...config,
		maxTokensField: "max_completion_tokens",
		authScheme: "api-key",
		normalizeBaseUrl: normalizeAzurev1BaseUrl,
		refineBadRequest: azureRefineBadRequest,
	});
}
