import type { CanonicalChatRequest } from "#core/canonical.ts";
import type { ResolvedModelMetadata } from "./types.ts";
import { GatewayError } from "#core/errors.ts";

export const PARAMETER_SUPPORT_MODES = [
	"supported",
	"unsupported",
	"ignored",
	"range",
	"mapped",
] as const;

export type ParameterSupportMode = (typeof PARAMETER_SUPPORT_MODES)[number];

export interface ParameterSupportSpec {
	mode?: ParameterSupportMode;
	min?: number;
	max?: number;
	values?: Array<string | number | boolean>;
	upstreamField?: string;
	notes?: string;
}

export type ParameterSupportEntry = boolean | ParameterSupportSpec;
export type ParameterSupportMap = Record<string, ParameterSupportEntry>;

export const UNSUPPORTED_PARAMETER_STRATEGIES = [
	"drop",
	"error",
	"allow",
] as const;

export type UnsupportedParameterStrategy =
	(typeof UNSUPPORTED_PARAMETER_STRATEGIES)[number];

type ParameterState = "supported" | "unsupported" | "unknown";

const DEFAULT_TEXT_PARAMETERS = [
	"max_tokens",
	"stop",
	"temperature",
	"top_p",
	"n",
	"presence_penalty",
	"frequency_penalty",
	"seed",
	"user",
	"response_format",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
	"reasoning",
	"reasoning_effort",
	"include_reasoning",
	"prompt_cache_key",
] as const;

function textParameters(meta: ResolvedModelMetadata): ParameterSupportMap {
	return meta.operations?.["text.generate"]?.parameters ?? {};
}

function parameterState(
	meta: ResolvedModelMetadata,
	name: string,
): ParameterState {
	const entry = textParameters(meta)[name];
	if (entry === undefined) return "unknown";
	if (typeof entry === "boolean") return entry ? "supported" : "unsupported";
	if (entry.mode === "unsupported" || entry.mode === "ignored")
		return "unsupported";
	if (
		entry.mode === "supported" ||
		entry.mode === "range" ||
		entry.mode === "mapped"
	)
		return "supported";
	return "supported";
}

function explicitlyUnsupportedName(
	meta: ResolvedModelMetadata,
	names: readonly string[],
): string | undefined {
	return names.find((name) => parameterState(meta, name) === "unsupported");
}

// Keyed by the model's `text.generate` parameter map, not by `meta` itself: `resolveModelMetadata`
// builds a fresh `meta` object on every call, but for built-in catalog models the parameter map is a
// stable reference into the catalog loaded once at startup, so this cache is effective across
// requests/candidates for the same model. Custom (operator-declared) models get a fresh map per DB
// read and simply don't benefit - no correctness impact, just no memoization for that case.
const supportedParameterNamesCache = new WeakMap<
	ParameterSupportMap,
	string[]
>();

export function supportedParameterNames(meta: ResolvedModelMetadata): string[] {
	const params = textParameters(meta);
	const cached = supportedParameterNamesCache.get(params);
	if (cached) return cached;

	const names = new Set<string>(DEFAULT_TEXT_PARAMETERS);
	if (!meta.capabilities.tools) {
		names.delete("tools");
		names.delete("tool_choice");
		names.delete("parallel_tool_calls");
	}
	if (!meta.capabilities.structuredOutputs) {
		names.delete("response_format");
	}
	if (!meta.capabilities.reasoning && meta.reasoning === undefined) {
		names.delete("reasoning");
		names.delete("reasoning_effort");
		names.delete("include_reasoning");
	}

	for (const [name, entry] of Object.entries(params)) {
		const state =
			typeof entry === "boolean"
				? entry
					? "supported"
					: "unsupported"
				: entry.mode === "unsupported" || entry.mode === "ignored"
					? "unsupported"
					: "supported";
		if (state === "unsupported") names.delete(name);
		else names.add(name);
	}
	const result = [...names].sort();
	supportedParameterNamesCache.set(params, result);
	return result;
}

interface FieldSpec {
	field: keyof CanonicalChatRequest;
	names: readonly string[];
}

const FIELD_SPECS: readonly FieldSpec[] = [
	{ field: "temperature", names: ["temperature"] },
	{ field: "topP", names: ["top_p"] },
	{ field: "topK", names: ["top_k"] },
	{ field: "maxTokens", names: ["max_tokens", "max_completion_tokens"] },
	{ field: "stop", names: ["stop"] },
	{ field: "n", names: ["n"] },
	{ field: "presencePenalty", names: ["presence_penalty"] },
	{ field: "frequencyPenalty", names: ["frequency_penalty"] },
	{ field: "seed", names: ["seed"] },
	{ field: "user", names: ["user"] },
	{ field: "tools", names: ["tools"] },
	{ field: "toolChoice", names: ["tool_choice"] },
	{ field: "parallelToolCalls", names: ["parallel_tool_calls"] },
	{ field: "responseFormat", names: ["response_format", "structured_outputs"] },
	{ field: "reasoning", names: ["reasoning", "reasoning_effort"] },
	{ field: "promptCacheKey", names: ["prompt_cache_key"] },
];

type ResponsesTransport = NonNullable<
	CanonicalChatRequest["responsesTransport"]
>;
type ChatTransport = NonNullable<CanonicalChatRequest["chatTransport"]>;
type MessagesTransport = NonNullable<CanonicalChatRequest["messagesTransport"]>;

const RESPONSES_TRANSPORT_SPECS: ReadonlyArray<{
	field: keyof ResponsesTransport;
	names: readonly string[];
}> = [
	{ field: "include", names: ["include"] },
	{ field: "metadata", names: ["metadata"] },
	{ field: "serviceTier", names: ["service_tier"] },
	{ field: "safetyIdentifier", names: ["safety_identifier"] },
	{ field: "promptCacheKey", names: ["prompt_cache_key"] },
	{ field: "topLogprobs", names: ["top_logprobs"] },
	{ field: "maxToolCalls", names: ["max_tool_calls"] },
	{ field: "user", names: ["user"] },
	{ field: "truncation", names: ["truncation"] },
	{ field: "contextManagement", names: ["context_management"] },
];

const CHAT_TRANSPORT_SPECS: ReadonlyArray<{
	field: keyof ChatTransport;
	names: readonly string[];
}> = [
	{ field: "audio", names: ["audio"] },
	{ field: "logprobs", names: ["logprobs"] },
	{ field: "topLogprobs", names: ["top_logprobs"] },
	{ field: "logitBias", names: ["logit_bias"] },
	{ field: "metadata", names: ["metadata"] },
	{ field: "modalities", names: ["modalities"] },
	{ field: "prediction", names: ["prediction"] },
	{ field: "serviceTier", names: ["service_tier"] },
	{ field: "safetyIdentifier", names: ["safety_identifier"] },
	{ field: "store", names: ["store"] },
	{ field: "verbosity", names: ["verbosity"] },
	{ field: "webSearchOptions", names: ["web_search_options"] },
];

const MESSAGES_TRANSPORT_SPECS: ReadonlyArray<{
	field: keyof MessagesTransport;
	names: readonly string[];
}> = [{ field: "metadata", names: ["metadata"] }];

function hasOwn(value: object, key: PropertyKey): boolean {
	return Object.hasOwn(value, key);
}

function dropCanonicalField(
	req: CanonicalChatRequest,
	field: keyof CanonicalChatRequest,
): void {
	switch (field) {
		case "temperature":
			delete req.temperature;
			break;
		case "topP":
			delete req.topP;
			break;
		case "topK":
			delete req.topK;
			break;
		case "maxTokens":
			delete req.maxTokens;
			break;
		case "stop":
			delete req.stop;
			break;
		case "n":
			delete req.n;
			break;
		case "presencePenalty":
			delete req.presencePenalty;
			break;
		case "frequencyPenalty":
			delete req.frequencyPenalty;
			break;
		case "seed":
			delete req.seed;
			break;
		case "user":
			delete req.user;
			break;
		case "tools":
			delete req.tools;
			break;
		case "toolChoice":
			delete req.toolChoice;
			break;
		case "parallelToolCalls":
			delete req.parallelToolCalls;
			break;
		case "responseFormat":
			delete req.responseFormat;
			break;
		case "reasoning":
			delete req.reasoning;
			break;
		case "promptCacheKey":
			delete req.promptCacheKey;
			break;
		default:
			break;
	}
}

function dropResponsesField(
	transport: ResponsesTransport,
	field: keyof ResponsesTransport,
): void {
	switch (field) {
		case "include":
			delete transport.include;
			break;
		case "metadata":
			delete transport.metadata;
			break;
		case "serviceTier":
			delete transport.serviceTier;
			break;
		case "safetyIdentifier":
			delete transport.safetyIdentifier;
			break;
		case "promptCacheKey":
			delete transport.promptCacheKey;
			break;
		case "topLogprobs":
			delete transport.topLogprobs;
			break;
		case "maxToolCalls":
			delete transport.maxToolCalls;
			break;
		case "user":
			delete transport.user;
			break;
		case "truncation":
			delete transport.truncation;
			break;
		case "contextManagement":
			delete transport.contextManagement;
			break;
		default:
			break;
	}
}

function dropTransportField<T extends object>(
	transport: T,
	field: keyof T,
): void {
	delete (transport as Record<PropertyKey, unknown>)[field];
}

function isEmptyRecord(value: Record<string, unknown>): boolean {
	return Object.keys(value).length === 0;
}

export interface ParameterPolicyResult {
	request: CanonicalChatRequest;
	unsupportedParameters: string[];
	droppedParameters: string[];
}

export function requestedUnsupportedParameters(
	req: CanonicalChatRequest,
	meta: ResolvedModelMetadata,
): string[] {
	const unsupported = new Set<string>();
	for (const spec of FIELD_SPECS) {
		if (!hasOwn(req, spec.field)) continue;
		const name = explicitlyUnsupportedName(meta, spec.names);
		if (name) unsupported.add(name);
	}
	for (const [name] of Object.entries(req.extraBody ?? {})) {
		if (parameterState(meta, name) === "unsupported") unsupported.add(name);
	}
	const transport = req.responsesTransport;
	if (transport) {
		for (const spec of RESPONSES_TRANSPORT_SPECS) {
			if (!hasOwn(transport, spec.field)) continue;
			const name = explicitlyUnsupportedName(meta, spec.names);
			if (name) unsupported.add(name);
		}
		for (const [name] of Object.entries(transport.text ?? {})) {
			if (parameterState(meta, name) === "unsupported") unsupported.add(name);
		}
		for (const [name] of Object.entries(transport.reasoning ?? {})) {
			if (parameterState(meta, name) === "unsupported") unsupported.add(name);
		}
	}
	const chatTransport = req.chatTransport;
	if (chatTransport) {
		for (const spec of CHAT_TRANSPORT_SPECS) {
			if (!hasOwn(chatTransport, spec.field)) continue;
			const name = explicitlyUnsupportedName(meta, spec.names);
			if (name) unsupported.add(name);
		}
	}
	const messagesTransport = req.messagesTransport;
	if (messagesTransport) {
		for (const spec of MESSAGES_TRANSPORT_SPECS) {
			if (!hasOwn(messagesTransport, spec.field)) continue;
			const name = explicitlyUnsupportedName(meta, spec.names);
			if (name) unsupported.add(name);
		}
	}
	return [...unsupported].sort();
}

export function assertSupportedChatParameters(
	req: CanonicalChatRequest,
	meta: ResolvedModelMetadata,
): void {
	const unsupported = requestedUnsupportedParameters(req, meta);
	if (unsupported.length === 0) return;
	throw new GatewayError({
		class: "bad_request",
		code: "unsupported_parameter",
		message: `The selected model does not support parameter(s): ${unsupported.join(", ")}`,
		param: unsupported[0] ?? null,
	});
}

export function applyUnsupportedParameterPolicy(
	req: CanonicalChatRequest,
	meta: ResolvedModelMetadata,
	strategy: UnsupportedParameterStrategy,
): ParameterPolicyResult {
	const unsupportedParameters = requestedUnsupportedParameters(req, meta);
	if (strategy === "allow" || unsupportedParameters.length === 0) {
		return { request: req, unsupportedParameters, droppedParameters: [] };
	}
	if (strategy === "error") {
		assertSupportedChatParameters(req, meta);
	}

	const unsupported = new Set(unsupportedParameters);
	const next: CanonicalChatRequest = { ...req };
	const dropped = new Set<string>();
	for (const spec of FIELD_SPECS) {
		if (!hasOwn(next, spec.field)) continue;
		const name = explicitlyUnsupportedName(meta, spec.names);
		if (!name || !unsupported.has(name)) continue;
		dropCanonicalField(next, spec.field);
		dropped.add(name);
	}
	if (next.extraBody !== undefined) {
		const extraBody = { ...next.extraBody };
		for (const name of Object.keys(extraBody)) {
			if (!unsupported.has(name)) continue;
			delete extraBody[name];
			dropped.add(name);
		}
		if (isEmptyRecord(extraBody)) delete next.extraBody;
		else next.extraBody = extraBody;
	}
	if (next.responsesTransport !== undefined) {
		const transport: ResponsesTransport = { ...next.responsesTransport };
		for (const spec of RESPONSES_TRANSPORT_SPECS) {
			if (!hasOwn(transport, spec.field)) continue;
			const name = explicitlyUnsupportedName(meta, spec.names);
			if (!name || !unsupported.has(name)) continue;
			dropResponsesField(transport, spec.field);
			dropped.add(name);
		}
		if (transport.text !== undefined) {
			const text = { ...transport.text };
			for (const name of Object.keys(text)) {
				if (!unsupported.has(name)) continue;
				delete text[name];
				dropped.add(name);
			}
			if (isEmptyRecord(text)) delete transport.text;
			else transport.text = text;
		}
		if (transport.reasoning !== undefined) {
			const reasoning = { ...transport.reasoning };
			for (const name of Object.keys(reasoning)) {
				if (!unsupported.has(name)) continue;
				delete reasoning[name];
				dropped.add(name);
			}
			if (isEmptyRecord(reasoning)) delete transport.reasoning;
			else transport.reasoning = reasoning;
		}
		if (isEmptyRecord(transport as Record<string, unknown>))
			delete next.responsesTransport;
		else next.responsesTransport = transport;
	}
	if (next.chatTransport !== undefined) {
		const transport: ChatTransport = { ...next.chatTransport };
		for (const spec of CHAT_TRANSPORT_SPECS) {
			if (!hasOwn(transport, spec.field)) continue;
			const name = explicitlyUnsupportedName(meta, spec.names);
			if (!name || !unsupported.has(name)) continue;
			dropTransportField(transport, spec.field);
			dropped.add(name);
		}
		if (isEmptyRecord(transport as Record<string, unknown>))
			delete next.chatTransport;
		else next.chatTransport = transport;
	}
	if (next.messagesTransport !== undefined) {
		const transport: MessagesTransport = { ...next.messagesTransport };
		for (const spec of MESSAGES_TRANSPORT_SPECS) {
			if (!hasOwn(transport, spec.field)) continue;
			const name = explicitlyUnsupportedName(meta, spec.names);
			if (!name || !unsupported.has(name)) continue;
			dropTransportField(transport, spec.field);
			dropped.add(name);
		}
		if (isEmptyRecord(transport as Record<string, unknown>))
			delete next.messagesTransport;
		else next.messagesTransport = transport;
	}

	return {
		request: next,
		unsupportedParameters,
		droppedParameters: [...dropped].sort(),
	};
}
