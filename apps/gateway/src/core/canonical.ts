import type { CanonicalReasoning } from "./reasoning.ts";
import type { Usage } from "./usage.ts";

/**
 * CANONICAL internal types, provider-agnostic. The endpoint translates OpenAI->canonical;
 * the adapter translates canonical->upstream and upstream->canonical. No concrete provider surfaces
 * here. For now they cover `chat`; the other CallTypes are added in their phase.
 */

export type CanonicalRole =
	| "system"
	| "developer"
	| "user"
	| "assistant"
	| "tool";

/**
 * Passthrough of `cache_control` (Anthropic-style prompt-caching breakpoint). It is opaque to the
 * core: filled in by the contract that understands it (Anthropic /messages) and emitted by the adapter
 * that supports it (Anthropic). Transports that do not support it (OpenAI, Google) simply ignore it.
 */
interface CanonicalCacheControlled {
	cacheControl?: Record<string, unknown>;
}
interface CanonicalTextPart extends CanonicalCacheControlled {
	type: "text";
	text: string;
}
export interface CanonicalImagePart extends CanonicalCacheControlled {
	type: "image";
	/** Public HTTPS URL or base64 data URL. */
	url: string;
	detail?: "auto" | "low" | "high";
}
interface CanonicalAudioPart extends CanonicalCacheControlled {
	type: "audio";
	/** Base64 audio. */
	data: string;
	format: "wav" | "mp3";
}
export interface CanonicalFilePart extends CanonicalCacheControlled {
	type: "file";
	/** Reference to a previously uploaded file (Files API). */
	fileId?: string;
	/** Direct file URL used by Responses-style inputs. */
	fileUrl?: string;
	/** Inline content as a base64 data URL (e.g. "data:application/pdf;base64,..."). */
	fileData?: string;
	filename?: string;
	/** Responses-only PDF rendering hint; ignored by transports that do not expose it. */
	detail?: "auto" | "low" | "high";
}
export type CanonicalContentPart =
	| CanonicalTextPart
	| CanonicalImagePart
	| CanonicalAudioPart
	| CanonicalFilePart;

interface CanonicalToolCall {
	id: string;
	name: string;
	/** Arguments as a JSON string (same as OpenAI). */
	arguments: string;
	/**
	 * Opaque provider/tool-call state that must round-trip with the tool call itself.
	 * Example: Gemini thought signatures exposed as `extra_content.google.thought_signature`.
	 */
	extraContent?: Record<string, unknown>;
}

export interface CanonicalMessage {
	role: CanonicalRole;
	content: string | CanonicalContentPart[] | null;
	name?: string;
	/** Only on assistant messages. */
	toolCalls?: CanonicalToolCall[];
	/** Only on role=tool messages: which tool_call it answers. */
	toolCallId?: string;
	/** Responses assistant-message phase; preserved across continuation and native transports. */
	phase?: "commentary" | "final_answer";
	/**
	 * Opaque provider-namespaced per-message state that must round-trip with the assistant message
	 * (e.g. OpenAI encrypted reasoning items as `providerFields.openai.reasoning`). Filled and
	 * consumed by contracts/transports; opaque to the core.
	 */
	providerFields?: Record<string, unknown>;
}

interface CanonicalTool extends CanonicalCacheControlled {
	name: string;
	description?: string;
	/** JSON Schema of the parameters. */
	parameters?: Record<string, unknown>;
	strict?: boolean;
}

export type CanonicalToolChoice =
	| "auto"
	| "none"
	| "required"
	| { name: string }
	| {
			allowedTools: string[];
			mode: "auto" | "required";
	  };

export type CanonicalResponseFormat =
	| { type: "text" }
	| { type: "json_object" }
	| {
			type: "json_schema";
			schema: Record<string, unknown>;
			/** Required by OpenAI; other providers do not expose it. */
			name?: string;
			description?: string;
			strict?: boolean;
	  };

export type CanonicalFinishReason =
	| "stop"
	| "length"
	| "tool_calls"
	| "content_filter";

interface CanonicalResponsesTransportOptions {
	include?: string[];
	metadata?: Record<string, unknown>;
	text?: Record<string, unknown>;
	reasoning?: Record<string, unknown>;
	streamOptions?: Record<string, unknown>;
	serviceTier?: string;
	safetyIdentifier?: string;
	promptCacheKey?: string;
	topLogprobs?: number;
	maxToolCalls?: number;
	user?: string;
	truncation?: string;
	contextManagement?: Record<string, unknown>[];
	/** Exact wire items retained when canonical emulation cannot represent them losslessly. */
	rawInput?: Record<string, unknown>[];
	/** Exact wire tools retained for native Responses transports. */
	rawTools?: Record<string, unknown>[];
}

interface CanonicalChatTransportOptions {
	audio?: Record<string, unknown>;
	logprobs?: boolean;
	topLogprobs?: number;
	logitBias?: Record<string, number>;
	metadata?: Record<string, string>;
	modalities?: string[];
	prediction?: Record<string, unknown>;
	serviceTier?: string;
	safetyIdentifier?: string;
	store?: boolean;
	verbosity?: string;
	webSearchOptions?: Record<string, unknown>;
	streamOptions?: Record<string, unknown>;
}

interface CanonicalMessagesTransportOptions {
	metadata?: Record<string, unknown>;
}

export type PublicChatWire = "chat_completions" | "responses" | "messages";

export type PdfParserEngine = "auto" | "native" | "pdf-text";

export interface CanonicalFileParserOptions {
	pdfEngine: PdfParserEngine;
}

export interface CanonicalChatRequest {
	callType: "chat";
	/** Public wire used by the client; routing uses it as a native-transport preference. */
	publicWire?: PublicChatWire;
	/** True when exact semantics require the native transport instead of canonical emulation. */
	requiresNativeWire?: boolean;
	/** Public model requested by the client. */
	model: string;
	messages: CanonicalMessage[];
	stream: boolean;
	/** Emit usage in the final stream chunk (stream_options.include_usage). */
	includeUsage?: boolean;
	temperature?: number;
	topP?: number;
	topK?: number;
	/** Normalized from max_tokens / max_completion_tokens. */
	maxTokens?: number;
	stop?: string[];
	n?: number;
	presencePenalty?: number;
	frequencyPenalty?: number;
	seed?: number;
	user?: string;
	tools?: CanonicalTool[];
	toolChoice?: CanonicalToolChoice;
	parallelToolCalls?: boolean;
	responseFormat?: CanonicalResponseFormat;
	/** Normalized reasoning effort (each adapter translates it to its native form). */
	reasoning?: CanonicalReasoning;
	/**
	 * Prompt-caching hint (OpenAI `prompt_cache_key`): groups requests that share a prefix to improve
	 * the hit ratio of the upstream's automatic prompt cache. Only emitted by transports that support
	 * it (OpenAI chat/responses); the rest ignore it.
	 */
	promptCacheKey?: string;
	/**
	 * Passthrough of "extra" keys to the upstream body that the gateway does NOT manage (e.g. top_k,
	 * repetition_penalty, guided_json in vLLM). Each adapter merges them at the end WITHOUT overwriting
	 * managed fields (see mergeExtraBody). Provider-shaped content, the client's responsibility.
	 */
	extraBody?: Record<string, unknown>;
	/** Options of the /responses contract consumed only by the upstream /responses transport. */
	responsesTransport?: CanonicalResponsesTransportOptions;
	/** Options consumed only by the upstream /chat/completions transport. */
	chatTransport?: CanonicalChatTransportOptions;
	/** Options consumed only by the upstream /messages transport. */
	messagesTransport?: CanonicalMessagesTransportOptions;
	/** Gateway-side file portability policy, normalized from the file-parser plugin. */
	fileParser?: CanonicalFileParserOptions;
}

interface CanonicalChatResponseChoice {
	index: number;
	finishReason: CanonicalFinishReason | null;
	/** Provider-native token log probabilities when available. */
	logprobs?: unknown;
	message: {
		role: "assistant";
		content: string | null;
		phase?: "commentary" | "final_answer";
		/** Visible reasoning/thinking summary, never the raw chain of thought. */
		reasoning?: string | null;
		toolCalls?: CanonicalToolCall[];
		refusal?: string | null;
		/** Native audio output object when the public/upstream chat wire supports it. */
		audio?: Record<string, unknown> | null;
		annotations?: Record<string, unknown>[];
		/** Opaque provider-namespaced per-message state (see CanonicalMessage.providerFields). */
		providerFields?: Record<string, unknown>;
	};
}

export interface CanonicalChatResponse {
	id: string;
	/** Epoch in seconds. */
	created: number;
	model: string;
	choices: CanonicalChatResponseChoice[];
	usage: Usage;
}

export interface CanonicalChatStreamChunk {
	id: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		/** Provider-native token log probabilities when available. */
		logprobs?: unknown;
		delta: {
			role?: "assistant";
			phase?: "commentary" | "final_answer";
			content?: string;
			/** Visible reasoning/thinking summary delta. */
			reasoning?: string;
			toolCalls?: Array<{ index: number } & Partial<CanonicalToolCall>>;
			refusal?: string;
			/** Native streaming audio delta when available. */
			audio?: Record<string, unknown>;
			annotations?: Record<string, unknown>[];
			/** Opaque provider-namespaced per-message state (see CanonicalMessage.providerFields). */
			providerFields?: Record<string, unknown>;
		};
		finishReason: CanonicalFinishReason | null;
	}>;
	/** Only present in the final chunk if includeUsage. */
	usage?: Usage | null;
}
