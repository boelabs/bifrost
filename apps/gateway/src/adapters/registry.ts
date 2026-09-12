import type { UpstreamTransport } from "#core/transport.ts";
import { ADAPTER_KEY_RULE, isAdapterKey } from "./key.ts";
import type { CallType } from "#core/callType.ts";
import type { Adapter } from "./types.ts";

/**
 * In-memory registry of adapters (defined in code). `model_deployments.adapter_key` references one of
 * these keys. It is the source of truth for which upstream protocols exist.
 */
const registry = new Map<string, Adapter>();

/** Maps each internal CallType to the handler that must exist on the adapter. */
const HANDLER_KEY: Partial<Record<CallType, keyof Adapter>> = {
	chat: "chat",
	"images.generations": "imageGeneration",
	"images.edits": "imageEdit",
	"videos.generations": "videoGeneration",
	"audio.transcriptions": "audioTranscription",
	embeddings: "embeddings",
	rerank: "rerank",
};
const CONTENT_INPUT_SOURCES = new Set(["provider_file_id", "url", "data_url"]);

function validateContentInputs(adapter: Adapter): void {
	const supportedTransports = new Set(
		Object.values(adapter.transports ?? {}).flatMap(
			(transports) => transports?.supported ?? [],
		),
	);
	for (const [transportName, inputs] of Object.entries(
		adapter.contentInputs ?? {},
	)) {
		const transport = transportName as UpstreamTransport;
		if (!supportedTransports.has(transport)) {
			throw new Error(
				`Adapter "${adapter.key}" declares content inputs for unsupported transport "${transport}".`,
			);
		}
		for (const [kind, support] of Object.entries(inputs ?? {})) {
			if (support.sources.length === 0) {
				throw new Error(
					`Adapter "${adapter.key}" declares no sources for ${kind} inputs on "${transport}".`,
				);
			}
			if (new Set(support.sources).size !== support.sources.length) {
				throw new Error(
					`Adapter "${adapter.key}" declares duplicate ${kind} input sources on "${transport}".`,
				);
			}
			if (
				support.sources.some(
					(source: string) => !CONTENT_INPUT_SOURCES.has(source),
				)
			) {
				throw new Error(
					`Adapter "${adapter.key}" declares an invalid ${kind} input source on "${transport}".`,
				);
			}
			if (
				support.maxBytes !== undefined &&
				(!Number.isSafeInteger(support.maxBytes) || support.maxBytes <= 0)
			) {
				throw new Error(
					`Adapter "${adapter.key}" declares an invalid ${kind} maxBytes on "${transport}".`,
				);
			}
			if (
				support.mimeTypes?.some(
					(mime: string) =>
						!/^[-a-z0-9!#$&^_.+]+\/(?:\*|[-a-z0-9!#$&^_.+]+)$/i.test(mime),
				)
			) {
				throw new Error(
					`Adapter "${adapter.key}" declares an invalid ${kind} MIME type on "${transport}".`,
				);
			}
		}
	}
}

export function registerAdapter(adapter: Adapter): void {
	if (!isAdapterKey(adapter.key)) {
		throw new Error(
			`Invalid adapter key "${adapter.key}": ${ADAPTER_KEY_RULE}.`,
		);
	}
	if (registry.has(adapter.key)) {
		throw new Error(`Duplicate adapter: "${adapter.key}"`);
	}
	// Consistency: every declared CallType must have its handler implemented.
	for (const ct of adapter.supportedCallTypes) {
		const capKey = HANDLER_KEY[ct];
		if (capKey && adapter[capKey] === undefined) {
			throw new Error(
				`Adapter "${adapter.key}" declares support for "${ct}" but does not implement its handler.`,
			);
		}
	}
	validateContentInputs(adapter);
	registry.set(adapter.key, adapter);
}

export function getAdapter(key: string): Adapter | undefined {
	return registry.get(key);
}

export function listAdapters(): Adapter[] {
	return [...registry.values()];
}

export function adapterSupportsCallType(
	key: string,
	callType: CallType,
): boolean {
	return registry.get(key)?.supportedCallTypes.has(callType) ?? false;
}

/** Test-only: clears the registry. */
export function __resetRegistry(): void {
	registry.clear();
}
