import type { CanonicalTranscriptionStreamEvent } from "#core/audio.ts";
import type { CanonicalChatStreamChunk } from "#core/canonical.ts";
import type { CanonicalImageStreamEvent } from "#core/images.ts";
import type { CallType } from "#core/callType.ts";
import type { Auth } from "#auth/types.ts";

import type {
	CanonicalTranscriptionResponse,
	CanonicalTranscriptionRequest,
} from "#core/audio.ts";

import type {
	CanonicalEmbeddingsResponse,
	CanonicalEmbeddingsRequest,
} from "#core/embeddings.ts";

import type {
	CanonicalRerankResponse,
	CanonicalRerankRequest,
} from "#core/rerank.ts";

import type {
	CanonicalChatResponse,
	CanonicalChatRequest,
} from "#core/canonical.ts";

import type {
	CanonicalImageResponse,
	CanonicalImageRequest,
} from "#core/images.ts";

export type MaybePromise<T> = T | Promise<T>;

export type ExtensionHookName =
	| "onCanonicalRequest"
	| "onCanonicalResponse"
	| "onStreamEvent"
	| "onImageOutput"
	| "onError";

export type ExtensionCanonicalRequest =
	| CanonicalChatRequest
	| CanonicalImageRequest
	| CanonicalEmbeddingsRequest
	| CanonicalTranscriptionRequest
	| CanonicalRerankRequest;

export type ExtensionCanonicalResponse =
	| CanonicalChatResponse
	| CanonicalImageResponse
	| CanonicalEmbeddingsResponse
	| CanonicalTranscriptionResponse
	| CanonicalRerankResponse;

export type ExtensionStreamEvent =
	| CanonicalChatStreamChunk
	| CanonicalImageStreamEvent
	| CanonicalTranscriptionStreamEvent;

export interface ExtensionImageOutput {
	data: Uint8Array;
	mimeType: "image/png" | "image/jpeg" | "image/webp";
	format: "png" | "jpeg" | "webp";
	width: number;
	height: number;
}

export interface ExtensionLogger {
	debug(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
}

export interface ExtensionPublicAuth {
	type: Auth["type"];
	virtualKeyId?: string;
	virtualKeyName?: string;
}

export interface ExtensionInstanceContext<Config = unknown, Match = unknown> {
	requestId: string;
	callType: CallType;
	endpoint: string;
	publicModel: string | null;
	auth: ExtensionPublicAuth;
	extensionKey: string;
	instanceId: string;
	critical: boolean;
	config: Config;
	match: Match;
	signal: AbortSignal;
	log: ExtensionLogger;
}

export interface ExtensionSetupContext {
	extensionKey: string;
	log: ExtensionLogger;
}

export interface ExtensionSchema<T = unknown> {
	safeParse(
		value: unknown,
	): { success: true; data: T } | { success: false; error: unknown };
}

export interface ExtensionHooks<Config = unknown, Match = unknown> {
	onCanonicalRequest?(
		ctx: ExtensionInstanceContext<Config, Match>,
		request: ExtensionCanonicalRequest,
	): MaybePromise<ExtensionCanonicalRequest | undefined>;
	onCanonicalResponse?(
		ctx: ExtensionInstanceContext<Config, Match>,
		response: ExtensionCanonicalResponse,
	): MaybePromise<ExtensionCanonicalResponse | undefined>;
	onStreamEvent?(
		ctx: ExtensionInstanceContext<Config, Match>,
		event: ExtensionStreamEvent,
	): MaybePromise<ExtensionStreamEvent | undefined>;
	onImageOutput?(
		ctx: ExtensionInstanceContext<Config, Match>,
		output: ExtensionImageOutput,
	): MaybePromise<ExtensionImageOutput | Uint8Array | undefined>;
	onError?(
		ctx: ExtensionInstanceContext<Config, Match>,
		error: unknown,
	): MaybePromise<void>;
}

export interface ExtensionDefinition<Config = unknown, Match = unknown> {
	key: string;
	version?: string;
	label?: string;
	description?: string;
	defaultCritical?: boolean;
	configSchema?: ExtensionSchema<Config>;
	matchSchema?: ExtensionSchema<Match>;
	setup?(ctx: ExtensionSetupContext): MaybePromise<void>;
	/**
	 * Releases resources acquired in `setup` (timers, connections, …). Called when a hot-reload
	 * removes this definition or replaces it with a different code version, so reloads do not leak.
	 */
	teardown?(ctx: ExtensionSetupContext): MaybePromise<void>;
	hooks: ExtensionHooks<Config, Match>;
}

export function defineExtension<Config = unknown, Match = unknown>(
	definition: ExtensionDefinition<Config, Match>,
): ExtensionDefinition<Config, Match> {
	return definition;
}
