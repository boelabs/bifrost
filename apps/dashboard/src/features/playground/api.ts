import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { csrfTokenFromDocument } from "#/shared/api/csrf.ts";
import { chatReasoningMiddleware } from "./chatReasoning";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { wrapLanguageModel } from "ai";
import { z } from "zod";

export const PUBLIC_ENDPOINTS = {
	"chat.completions": {
		label: "Chat Completions",
		path: "/v1/chat/completions",
	},
	responses: { label: "Responses", path: "/v1/responses" },
	messages: { label: "Messages (Anthropic)", path: "/v1/messages" },
} as const;

export type PublicEndpoint = keyof typeof PUBLIC_ENDPOINTS;

export function isPublicEndpoint(value: unknown): value is PublicEndpoint {
	return typeof value === "string" && Object.hasOwn(PUBLIC_ENDPOINTS, value);
}

export interface PlaygroundSettings {
	systemPrompt: string;
	parameters: Record<string, number>;
	reasoningEffort?: string;
	stopSequences: string[];
}

export const emptySettings = (): PlaygroundSettings => ({
	systemPrompt: "",
	parameters: {},
	stopSequences: [],
});

const requestBody = z.record(z.string(), z.unknown());

/** What each contract calls the gateway parameters the SDKs filter out on their way through. */
const PARAMETER_FIELDS: Record<string, Record<string, string>> = {
	messages: { stop: "stop_sequences", max_tokens: "max_tokens" },
	responses: { max_tokens: "max_output_tokens" },
	default: { max_tokens: "max_tokens" },
};

/**
 * The call signature this module actually uses, deliberately not `typeof fetch`.
 *
 * Under Bun's ambient types that alias carries extras nothing here touches (`preconnect`), and
 * requiring them on an INPUT forces every caller — every test stub included — to fake a surface that
 * is never called. The value returned still satisfies whatever the SDK asks for.
 */
export type FetchLike = (
	input: URL | RequestInfo,
	init?: RequestInit,
) => Promise<Response>;

/** SDK providers encode the protocol; deployment metadata, not vendor model-name heuristics, owns settings. */
export function createSessionFetch(
	endpoint: PublicEndpoint,
	settings: PlaygroundSettings,
	options: { fetch?: FetchLike; csrf?: () => string | undefined } = {},
): FetchLike {
	return (input, init) => {
		const headers = new Headers(init?.headers);
		headers.delete("authorization");
		headers.delete("x-api-key");
		const token = (options.csrf ?? csrfTokenFromDocument)();
		if (token) {
			headers.set("x-csrf-token", token);
		}
		if (typeof init?.body !== "string") {
			throw new Error("Expected an SDK JSON inference request.");
		}
		const body = requestBody.parse(JSON.parse(init.body));
		// Restore explicitly selected gateway parameters after SDK vendor-specific filtering.
		const fields = PARAMETER_FIELDS[endpoint] ?? PARAMETER_FIELDS.default;
		for (const [key, value] of Object.entries(settings.parameters)) {
			body[fields[key] ?? key] = value;
		}
		if (
			settings.parameters.max_tokens !== undefined &&
			endpoint === "chat.completions"
		) {
			delete body.max_completion_tokens;
		}
		const stopSequences = settings.stopSequences.filter(
			(sequence) => sequence.length > 0,
		);
		if (stopSequences.length) {
			body[endpoint === "messages" ? "stop_sequences" : "stop"] = stopSequences;
		}
		if (settings.reasoningEffort !== undefined) {
			if (endpoint === "messages") {
				body.output_config = {
					...requestBody.parse(body.output_config ?? {}),
					effort: settings.reasoningEffort,
				};
				body.thinking = {
					type: settings.reasoningEffort === "none" ? "disabled" : "adaptive",
					...(settings.reasoningEffort === "none"
						? {}
						: { display: "summarized" }),
				};
			} else if (endpoint === "responses") {
				body.reasoning = {
					effort: settings.reasoningEffort,
					...(settings.reasoningEffort === "none" ? {} : { summary: "auto" }),
				};
			} else {
				body.reasoning_effort = settings.reasoningEffort;
			}
		}
		if (endpoint !== "messages") {
			body.store = false;
		}
		return (options.fetch ?? fetch)(input, {
			...init,
			body: JSON.stringify(body),
			headers,
			credentials: "include",
		});
	};
}

/**
 * The address a provider is handed, always absolute.
 *
 * The playground's own base is this app's `/api/v1` relay, a root-relative path — and
 * `@ai-sdk/openai-compatible` builds its request address with `new URL()`, which rejects one
 * ("Failed to construct 'URL': Invalid URL"). The other two providers concatenate strings and
 * survive it, so resolving here keeps all three on the same address.
 */
function absoluteBaseURL(baseURL: string): string {
	if (/^[a-z][a-z\d+.-]*:\/\//i.test(baseURL)) {
		return baseURL;
	}
	if (typeof window === "undefined") {
		throw new Error("A relative gateway base URL needs a document origin.");
	}
	return new URL(baseURL, window.location.origin).toString();
}

export function modelFor(
	endpoint: PublicEndpoint,
	publicModel: string,
	settings: PlaygroundSettings,
	options: {
		fetch?: FetchLike;
		/**
		 * The `/v1` the request is sent to — either absolute, or relative to this app's own origin
		 * (which is what the playground passes: the route behind it relays to the gateway and keeps
		 * the stream a stream). Required rather than guessed: the address is served rather than
		 * compiled in, so only the caller can know it.
		 */
		baseURL: string;
		csrf?: () => string | undefined;
	},
): LanguageModel {
	const baseURL = absoluteBaseURL(options.baseURL);
	// The SDK providers type their `fetch` option as the whole ambient `fetch`, which under Bun's
	// types includes `preconnect` — a connection hint none of them ever calls. The assertion is
	// confined to this boundary so the option and the test stubs stay honest about what is used.
	const sessionFetch = createSessionFetch(
		endpoint,
		settings,
		options,
	) as unknown as typeof fetch;
	if (endpoint === "messages") {
		return createAnthropic({ baseURL, apiKey: "session", fetch: sessionFetch })(
			publicModel,
		);
	}
	if (endpoint === "chat.completions") {
		return wrapLanguageModel({
			model: createOpenAICompatible({
				name: "bifrost",
				baseURL,
				fetch: sessionFetch,
				includeUsage: true,
			})(publicModel),
			middleware: chatReasoningMiddleware,
		});
	}
	return createOpenAI({
		baseURL,
		apiKey: "session",
		fetch: sessionFetch,
	}).responses(publicModel);
}

export function providerOptionsFor(endpoint: PublicEndpoint) {
	return endpoint === "responses" ? { openai: { store: false } } : undefined;
}
