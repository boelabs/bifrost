import { recordMessageStateDiscard } from "#telemetry/index.ts";
import { log } from "#logging/log.ts";

import {
	type MessageStateDiscardReason,
	type DecodedMessageState,
	type MessageStateAnchor,
	type MessageStateCodec,
	GATEWAY_STATE_PREFIX,
	type MessageState,
} from "#core/providerSpecificFields.ts";

import {
	parseEncryptedEnvelope,
	decryptJson,
	encryptJson,
} from "#db/crypto.ts";

/**
 * Gateway carrier for message-bound provider state (see `core/providerSpecificFields.ts`): the
 * state is sealed with the gateway keyring and travels as a `reasoning` item's
 * `encrypted_content`, so nothing is stored server-side. Carriers never expire, because
 * conversations outlive any reasonable TTL; one that cannot be opened (key rotated out, tampered,
 * unknown version) is dropped and the request continues without it.
 */
const VERSION = 1;
const PREFIX = `${GATEWAY_STATE_PREFIX}${VERSION}.`;

interface MessageStatePayload extends MessageStateAnchor {
	version: typeof VERSION;
	provider: MessageState["provider"];
	state: Record<string, unknown>[];
}

function reportDiscard(reason: MessageStateDiscardReason): void {
	log.warn("message-state", "discarded replayed provider state", { reason });
	recordMessageStateDiscard(reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decode(
	value: string,
	discard: (reason: MessageStateDiscardReason) => void,
): DecodedMessageState | undefined {
	if (!value.startsWith(PREFIX)) {
		discard("unsupported");
		return undefined;
	}
	let decoded: unknown;
	try {
		const envelope = parseEncryptedEnvelope(
			JSON.parse(
				Buffer.from(value.slice(PREFIX.length), "base64url").toString("utf8"),
			),
		);
		decoded = decryptJson(envelope, "reasoning-state");
	} catch {
		discard("undecryptable");
		return undefined;
	}
	if (!isRecord(decoded)) {
		discard("malformed");
		return undefined;
	}
	const { version, provider, messageId, callId, state } =
		decoded as Partial<MessageStatePayload>;
	if (
		version !== VERSION ||
		(provider !== "google" && provider !== "anthropic")
	) {
		discard("unsupported");
		return undefined;
	}
	const anchored =
		typeof messageId === "string" ||
		(provider === "anthropic" && typeof callId === "string");
	if (
		!anchored ||
		(messageId !== undefined && typeof messageId !== "string") ||
		(callId !== undefined && typeof callId !== "string") ||
		!Array.isArray(state) ||
		!state.every(isRecord)
	) {
		discard("malformed");
		return undefined;
	}
	return {
		provider,
		state,
		...(messageId === undefined ? {} : { messageId }),
		...(callId === undefined ? {} : { callId }),
	};
}

function encode(
	{ messageId, callId }: MessageStateAnchor,
	{ provider, state }: MessageState,
): string {
	const envelope = encryptJson(
		{
			version: VERSION,
			provider,
			...(messageId === undefined ? {} : { messageId }),
			...(callId === undefined ? {} : { callId }),
			state,
		} satisfies MessageStatePayload,
		"reasoning-state",
	);
	return `${PREFIX}${Buffer.from(JSON.stringify(envelope)).toString("base64url")}`;
}

/** `discard` is injectable for tests; the default logs a warning and counts the reason. */
export function createMessageStateCodec(
	discard: (reason: MessageStateDiscardReason) => void = reportDiscard,
): MessageStateCodec {
	return { encode, decode: (value) => decode(value, discard), discard };
}

export const messageStateCodec = createMessageStateCodec();
