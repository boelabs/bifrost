import type { ChatTransport, LanguageModelUsage, UIMessage } from "ai";
import type { PlaygroundSettings, PublicEndpoint } from "./api";
import { modelFor, providerOptionsFor } from "./api";
import type { ProviderMetadata } from "ai";

import {
	convertToModelMessages,
	toUIMessageStream,
	stepCountIs,
	streamText,
} from "ai";

export interface ResponseMetrics {
	providerMetadata?: ProviderMetadata;
	ttftMs?: number;
	firstTextMs?: number;
	durationMs?: number;
	textDurationMs?: number;
	outputTokensPerSecond?: number;
	requestTokensPerSecond?: number;
	inputTokens?: number;
	outputTokens?: number;
	reasoningTokens?: number;
	cachedInputTokens?: number;
	totalTokens?: number;
	finishReason?: string;
	warnings?: string[];
	state?: "streaming" | "completed" | "stopped" | "failed";
}

export type PlaygroundMessage = UIMessage<ResponseMetrics>;

/** One numeric field of an untyped usage-details object, if it is really there and numeric. */
function numberField(source: unknown, field: string): number | undefined {
	if (!source || typeof source !== "object" || Array.isArray(source)) {
		return undefined;
	}
	const value = (source as Record<string, unknown>)[field];
	return typeof value === "number" ? value : undefined;
}

function tokenCount(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: undefined;
}

export function usageMetrics(
	usage: LanguageModelUsage,
	durationMs: number,
	endpoint?: PublicEndpoint,
): ResponseMetrics {
	const raw = endpoint === "chat.completions" ? usage.raw : undefined;
	const inputTokens = tokenCount(raw ? raw.prompt_tokens : usage.inputTokens);
	const outputTokens = tokenCount(
		raw ? raw.completion_tokens : usage.outputTokens,
	);
	const inputDetails = raw?.prompt_tokens_details;
	const outputDetails = raw?.completion_tokens_details;
	return {
		inputTokens,
		outputTokens,
		totalTokens:
			inputTokens !== undefined && outputTokens !== undefined
				? tokenCount(inputTokens + outputTokens)
				: undefined,
		reasoningTokens: tokenCount(
			raw
				? numberField(outputDetails, "reasoning_tokens")
				: usage.outputTokenDetails.reasoningTokens,
		),
		cachedInputTokens: tokenCount(
			raw
				? numberField(inputDetails, "cached_tokens")
				: usage.inputTokenDetails.cacheReadTokens,
		),
		requestTokensPerSecond:
			outputTokens !== undefined &&
			Number.isFinite(durationMs) &&
			durationMs > 0
				? outputTokens / (durationMs / 1000)
				: undefined,
	};
}

export function textStreamingMetrics(
	usage: ResponseMetrics,
	firstTextMs: number | undefined,
	lastTextMs: number | undefined,
	textChunks: number,
	hasReasoning: boolean,
): Pick<ResponseMetrics, "textDurationMs" | "outputTokensPerSecond"> {
	const duration =
		firstTextMs !== undefined && lastTextMs !== undefined
			? lastTextMs - firstTextMs
			: undefined;
	const tokens =
		usage.outputTokens !== undefined &&
		(!hasReasoning || usage.reasoningTokens !== undefined)
			? usage.outputTokens - (usage.reasoningTokens ?? 0)
			: undefined;
	return {
		textDurationMs: duration,
		// A chunk can contain several tokens: this is a client-observed estimate.
		outputTokensPerSecond:
			textChunks > 1 &&
			duration !== undefined &&
			duration > 0 &&
			tokens !== undefined &&
			Number.isSafeInteger(tokens) &&
			tokens > 1
				? (tokens - 1) / (duration / 1000)
				: undefined,
	};
}

export function createPlaygroundTransport(
	endpoint: PublicEndpoint,
	modelId: string,
	settings: PlaygroundSettings,
	options: Partial<Parameters<typeof modelFor>[3]> & {
		now?: () => number;
	} = {},
): ChatTransport<PlaygroundMessage> {
	return {
		async sendMessages({ messages, abortSignal }) {
			const now = options.now ?? (() => performance.now());
			const modelMessages = await convertToModelMessages(
				messages.map((message) => {
					const metadata = message.metadata?.providerMetadata;
					if (
						endpoint !== "chat.completions" ||
						message.role !== "assistant" ||
						!metadata?.bifrost?.reasoning
					) {
						return message;
					}
					const index = message.parts.findIndex(
						(part) => part.type === "text" || part.type === "reasoning",
					);
					return {
						...message,
						parts: message.parts.map((part, partIndex) =>
							partIndex === index &&
							(part.type === "text" || part.type === "reasoning")
								? {
										...part,
										providerMetadata: {
											...part.providerMetadata,
											bifrost: metadata.bifrost,
										},
									}
								: part,
						),
					};
				}),
			);
			const start = now();
			let metrics: ResponseMetrics = { state: "streaming" };
			let lastTextMs: number | undefined;
			let textChunks = 0;
			let hasReasoning = false;
			let reportedUsage: LanguageModelUsage | undefined;
			const result = streamText({
				// Resolved here, not when the transport was built: the address comes from the
				// dashboard's own `/api/config` and the answer may still be in flight while the
				// operator is typing. By the time a message is sent it is there.
				model: modelFor(endpoint, modelId, settings, {
					...options,
					// This app's own origin: the route behind it relays to the gateway and keeps
					// the stream a stream. Tests pass a literal and never reach the network.
					baseURL: options.baseURL ?? "/api/v1",
				}),
				messages: modelMessages,
				...(settings.systemPrompt ? { system: settings.systemPrompt } : {}),
				...(endpoint === "messages"
					? { maxOutputTokens: settings.parameters.max_tokens ?? 1024 }
					: {}),
				providerOptions: providerOptionsFor(endpoint),
				abortSignal,
				maxRetries: 0,
				stopWhen: stepCountIs(10),
				onError: () => {
					/* The UI stream below delivers the original error to useChat. */
				},
			});
			return toUIMessageStream({
				stream: result.stream,
				originalMessages: messages,
				generateMessageId: () => crypto.randomUUID(),
				sendReasoning: true,
				sendSources: true,
				onError: (cause) =>
					cause instanceof Error
						? cause.message
						: "The inference request failed.",
				messageMetadata: ({ part }): ResponseMetrics | undefined => {
					const elapsed = now() - start;
					if (part.type === "finish-step") {
						reportedUsage = part.usage;
						if (part.providerMetadata) {
							metrics = { ...metrics, providerMetadata: part.providerMetadata };
						}
					}
					if (
						(part.type === "text-delta" || part.type === "reasoning-delta") &&
						part.text.length > 0
					) {
						if (part.type === "text-delta") {
							lastTextMs = elapsed;
							textChunks++;
						} else {
							hasReasoning = true;
						}
						metrics = {
							...metrics,
							ttftMs: metrics.ttftMs ?? elapsed,
							...(part.type === "text-delta"
								? { firstTextMs: metrics.firstTextMs ?? elapsed }
								: {}),
						};
						return metrics;
					}
					if (part.type === "start-step" && part.warnings.length) {
						metrics = {
							...metrics,
							warnings: part.warnings.map((warning) => JSON.stringify(warning)),
						};
						return metrics;
					}
					if (part.type === "finish") {
						const usage = usageMetrics(
							reportedUsage ?? part.totalUsage,
							elapsed,
							endpoint,
						);
						return {
							...metrics,
							...usage,
							...textStreamingMetrics(
								usage,
								metrics.firstTextMs,
								lastTextMs,
								textChunks,
								hasReasoning,
							),
							durationMs: elapsed,
							finishReason: part.finishReason,
							state: "completed",
						};
					}
					if (part.type === "abort" || part.type === "error") {
						return {
							...metrics,
							durationMs: elapsed,
							state: part.type === "abort" ? "stopped" : "failed",
						};
					}
					return part.type === "start" ? metrics : undefined;
				},
			});
		},
		async reconnectToStream() {
			return null;
		},
	};
}
