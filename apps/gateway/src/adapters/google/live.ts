import { upstreamWebSocket } from "#gateway/instrumentedTransport.ts";
import { realtimeTranscriptionProfileFor } from "#catalog/types.ts";
import { abortGatewayError } from "#gateway/abortReason.ts";
import type { BaseCreds } from "#adapters/creds.ts";
import { GatewayError } from "#core/errors.ts";
import type { RawData } from "ws";
import type WebSocket from "ws";

import {
	type CanonicalRealtimeTranscriptionConfig,
	type CanonicalRealtimeTranscriptionEvent,
	type RealtimeUsage,
	REALTIME_AUDIO_SAMPLE_RATE,
} from "#core/realtime.ts";

import type {
	RealtimeTranscriptionHandler,
	RealtimeTranscriptionSession,
	AdapterContext,
} from "#adapters/types.ts";

/**
 * Gemini Transcribe Live over the Live API (`BidiGenerateContent` WebSocket).
 *
 * One public session can outlive one Gemini connection: Gemini ends a transcription session after
 * ten minutes and warns first with `goAway`. The session then opens a fresh connection with the same
 * setup, moves the audio to it, and lets the old one deliver its last transcript before closing it.
 */

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const AUDIO_MIME = `audio/pcm;rate=${REALTIME_AUDIO_SAMPLE_RATE}`;
/** Gemini recommends 100 ms audio chunks. */
const CHUNK_BYTES = (REALTIME_AUDIO_SAMPLE_RATE / 10) * 2;
/** How long a replaced connection may keep delivering its last transcript. */
const DRAIN_MS = 10_000;
/** Without a `goAway`, a capped connection is replaced this long before its cap. */
const ROTATE_EARLY_MS = 30_000;

interface LiveDeps {
	creds: (ctx: AdapterContext) => BaseCreds & { apiKey: string };
	mapError: (err: unknown, ctx: AdapterContext) => GatewayError;
}

/** `https://host/v1beta` -> the Live API WebSocket URL for that host and API version. */
export function geminiLiveUrl(baseUrl: string | undefined): string {
	const url = new URL(baseUrl ?? DEFAULT_BASE);
	const version =
		url.pathname
			.split("/")
			.findLast((segment) => /^v\d+(?:alpha|beta)?\d*$/.test(segment)) ??
		"v1beta";
	const protocol = url.protocol === "http:" ? "ws:" : "wss:";
	return `${protocol}//${url.host}/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent`;
}

export function geminiLiveSetup(
	config: CanonicalRealtimeTranscriptionConfig,
	upstreamModel: string,
	options: { supportsKeywords: boolean },
): Record<string, unknown> {
	const transcription: Record<string, unknown> = {};
	const languages =
		config.languages ??
		(config.language === undefined ? [] : [config.language]);
	if (languages.length > 0) {
		transcription.languageCodes = languages;
	}
	if (
		options.supportsKeywords &&
		config.keywords &&
		config.keywords.length > 0
	) {
		transcription.customVocabulary = config.keywords;
	}
	if (config.mode === "smart") {
		transcription.mode = "SMART";
	}
	return {
		setup: {
			model: upstreamModel.startsWith("models/")
				? upstreamModel
				: `models/${upstreamModel}`,
			generationConfig: { responseModalities: ["TEXT"] },
			inputAudioTranscription: transcription,
			...(config.turnDetection === "manual"
				? {
						realtimeInputConfig: {
							automaticActivityDetection: { disabled: true },
						},
					}
				: {}),
		},
	};
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: undefined;
}

function modalityCount(details: unknown, modality: string): number | undefined {
	if (!Array.isArray(details)) {
		return undefined;
	}
	let total: number | undefined;
	for (const entryValue of details) {
		const entry = record(entryValue);
		const tokens = count(entry?.tokenCount);
		if (
			tokens !== undefined &&
			typeof entry?.modality === "string" &&
			entry.modality.toUpperCase() === modality
		) {
			total = (total ?? 0) + tokens;
		}
	}
	return total;
}

/** Live API `usageMetadata` -> realtime usage. Thinking and tool-use prompt tokens count too. */
export function geminiLiveUsage(raw: unknown): RealtimeUsage | undefined {
	const usage = record(raw);
	if (!usage) {
		return undefined;
	}
	const input =
		(count(usage.promptTokenCount) ?? 0) +
		(count(usage.toolUsePromptTokenCount) ?? 0);
	const output =
		(count(usage.responseTokenCount) ??
			count(usage.candidatesTokenCount) ??
			0) + (count(usage.thoughtsTokenCount) ?? 0);
	if (input === 0 && output === 0) {
		return undefined;
	}
	const details = {
		audioTokens: modalityCount(usage.promptTokensDetails, "AUDIO"),
		textTokens: modalityCount(usage.promptTokensDetails, "TEXT"),
		imageTokens:
			modalityCount(usage.promptTokensDetails, "IMAGE") ??
			modalityCount(usage.promptTokensDetails, "VIDEO"),
		outputAudioTokens: modalityCount(usage.responseTokensDetails, "AUDIO"),
		outputTextTokens: modalityCount(usage.responseTokensDetails, "TEXT"),
	};
	return {
		inputTokens: input,
		outputTokens: output,
		totalTokens: input + output,
		...Object.fromEntries(
			Object.entries(details).filter(([, value]) => value !== undefined),
		),
	};
}

/** One parsed server message, reduced to what a transcription session acts on. */
export interface GeminiLiveMessage {
	setupComplete: boolean;
	interim?: string;
	final?: string;
	usage?: RealtimeUsage;
	goAway: boolean;
}

export function parseGeminiLiveMessage(raw: unknown): GeminiLiveMessage {
	const message = record(raw) ?? {};
	const content = record(message.serverContent);
	const interim = record(content?.interimInputTranscription)?.text;
	const final = record(content?.inputTranscription)?.text;
	const usage = geminiLiveUsage(message.usageMetadata);
	return {
		setupComplete: message.setupComplete !== undefined,
		...(typeof interim === "string" ? { interim } : {}),
		...(typeof final === "string" ? { final } : {}),
		...(usage ? { usage } : {}),
		goAway: message.goAway !== undefined,
	};
}

/**
 * The HTTP status a WebSocket close stands for, so the provider's own error mapping (auth, quota,
 * bad request, outage) applies to it.
 */
export function closeStatus(code: number, reason: string): number {
	// Word boundaries: "BidiGenerateContent" contains "rate".
	if (/\bquota\b|\brate.?limit|\bexhausted\b/i.test(reason)) {
		return 429;
	}
	if (/api key|permission|unauthori[sz]ed|forbidden|credential/i.test(reason)) {
		return 403;
	}
	if (code === 1007 || code === 1008) {
		return /not found/i.test(reason) ? 404 : 400;
	}
	if (code === 1012 || code === 1013) {
		return 503;
	}
	return code === 1011 ? 500 : 502;
}

export function rawText(data: RawData): string {
	if (Array.isArray(data)) {
		return Buffer.concat(data).toString("utf8");
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString("utf8");
	}
	return data.toString("utf8");
}

export class EventQueue<T> {
	private readonly values: T[] = [];
	private waiter: {
		resolve: (value: IteratorResult<T>) => void;
		reject: (reason: unknown) => void;
	} | null = null;
	private failure: unknown;
	private ended = false;

	push(value: T): void {
		if (this.ended) {
			return;
		}
		if (this.waiter) {
			this.waiter.resolve({ done: false, value });
			this.waiter = null;
		} else {
			this.values.push(value);
		}
	}

	end(): void {
		this.ended = true;
		this.waiter?.resolve({ done: true, value: undefined });
		this.waiter = null;
	}

	fail(error: unknown): void {
		if (this.ended) {
			return;
		}
		this.ended = true;
		this.failure = error;
		this.waiter?.reject(error);
		this.waiter = null;
	}

	async *iterate(): AsyncIterable<T> {
		while (true) {
			const queued = this.values.shift();
			if (queued !== undefined) {
				yield queued;
				continue;
			}
			if (this.failure !== undefined) {
				throw this.failure;
			}
			if (this.ended) {
				return;
			}
			const next = await new Promise<IteratorResult<T>>((resolve, reject) => {
				this.waiter = { resolve, reject };
			});
			if (next.done) {
				return;
			}
			yield next.value;
		}
	}
}

interface LiveConnection {
	socket: WebSocket;
	send: (message: Record<string, unknown>) => void;
	/** Set when the gateway itself retires this connection. */
	retired: boolean;
}

export function makeGeminiRealtimeTranscriptionHandler(
	deps: LiveDeps,
): RealtimeTranscriptionHandler {
	return {
		async connect(config, ctx): Promise<RealtimeTranscriptionSession> {
			const c = deps.creds(ctx);
			const profile = realtimeTranscriptionProfileFor(ctx.meta);
			const setup = geminiLiveSetup(config, ctx.upstreamModel, {
				supportsKeywords: profile?.supportsKeywords === true,
			});
			const url = geminiLiveUrl(c.baseUrl);
			const queue = new EventQueue<CanonicalRealtimeTranscriptionEvent>();
			let closed = false;
			let current: LiveConnection;
			let rotating: Promise<void> | null = null;
			let rotateAfterUtterance = false;
			let utteranceOpen = false;
			let pending: Buffer[] = [];
			let pendingBytes = 0;
			let capTimer: ReturnType<typeof setTimeout> | undefined;

			/** Replaces the connection before the provider's cap, in case no `goAway` comes. */
			const armCap = () => {
				clearTimeout(capTimer);
				const capSeconds = profile?.maxUpstreamSessionSeconds;
				if (capSeconds === undefined) {
					return;
				}
				capTimer = setTimeout(
					() => requestRotation(),
					Math.max(1000, capSeconds * 1000 - ROTATE_EARLY_MS),
				);
				capTimer.unref?.();
			};

			const fail = (error: unknown) => {
				closed = true;
				clearTimeout(capTimer);
				queue.fail(error);
			};

			/** Opens one Gemini connection and resolves after `setupComplete`. */
			const open = (): Promise<LiveConnection> =>
				new Promise<LiveConnection>((resolve, reject) => {
					const socket = upstreamWebSocket(ctx, url, {
						headers: { "x-goog-api-key": c.apiKey, ...(c.headers ?? {}) },
					});
					const connection: LiveConnection = {
						socket,
						retired: false,
						send(message) {
							if (socket.readyState === socket.OPEN) {
								socket.send(JSON.stringify(message));
							}
						},
					};
					let ready = false;
					socket.once("open", () => connection.send(setup));
					socket.on("message", (data) => {
						let raw: unknown;
						try {
							raw = JSON.parse(rawText(data));
						} catch (cause) {
							const error = new GatewayError({
								class: "server",
								code: "upstream_protocol_error",
								message: "Gemini Live emitted a message that is not JSON",
								cause,
							});
							if (ready) {
								fail(error);
							} else {
								reject(error);
							}
							return;
						}
						const message = parseGeminiLiveMessage(raw);
						if (message.setupComplete && !ready) {
							ready = true;
							resolve(connection);
						}
						// Usage first: when it shares a message with a final transcript, it belongs to it.
						if (message.usage) {
							queue.push({ kind: "usage", usage: message.usage });
						}
						if (message.interim !== undefined) {
							queue.push({ kind: "interim", text: message.interim });
						}
						if (message.final !== undefined) {
							queue.push({ kind: "final", text: message.final });
						}
						if (message.goAway && !connection.retired) {
							requestRotation();
						}
					});
					socket.on("error", (error) => {
						if (!ready) {
							reject(deps.mapError(error, ctx));
						}
					});
					socket.on("close", (code, reasonBuffer) => {
						if (ctx.signal?.aborted) {
							const error = abortGatewayError(ctx.signal);
							if (ready) {
								fail(error);
							} else {
								reject(error);
							}
							return;
						}
						const reason = reasonBuffer.toString();
						const error = deps.mapError(
							{
								status: closeStatus(code, reason),
								body: {
									error: {
										code,
										message: reason || `Gemini Live closed with code ${code}`,
									},
								},
							},
							ctx,
						);
						if (!ready) {
							reject(error);
							return;
						}
						if (connection.retired || closed) {
							return;
						}
						if (connection === current) {
							fail(error);
						}
					});
				});

			const flushAudio = () => {
				if (pendingBytes === 0) {
					return;
				}
				const audio = Buffer.concat(pending);
				pending = [];
				pendingBytes = 0;
				current.send({
					realtimeInput: {
						audio: { data: audio.toString("base64"), mimeType: AUDIO_MIME },
					},
				});
			};

			const retire = (connection: LiveConnection) => {
				connection.retired = true;
				const timer = setTimeout(() => connection.socket.close(1000), DRAIN_MS);
				timer.unref?.();
				connection.socket.once("close", () => clearTimeout(timer));
			};

			const rotate = () => {
				if (rotating || closed) {
					return;
				}
				rotating = open()
					.then((next) => {
						const previous = current;
						flushAudio();
						current = next;
						armCap();
						if (config.turnDetection === "server_vad") {
							// Finalize whatever the old connection was still hearing.
							previous.send({ realtimeInput: { audioStreamEnd: true } });
						}
						retire(previous);
					})
					.catch((error: unknown) => fail(error))
					.finally(() => {
						rotating = null;
					});
			};

			function requestRotation() {
				// A manual utterance belongs to one connection; move after it ends.
				if (config.turnDetection === "manual" && utteranceOpen) {
					rotateAfterUtterance = true;
					return;
				}
				rotate();
			}

			current = await open();
			armCap();
			ctx.watchdog?.headers();
			ctx.watchdog?.complete();

			return {
				appendAudio(pcm) {
					if (closed) {
						return;
					}
					pending.push(pcm);
					pendingBytes += pcm.byteLength;
					if (pendingBytes >= CHUNK_BYTES) {
						flushAudio();
					}
				},
				startUtterance() {
					if (closed || config.turnDetection !== "manual" || utteranceOpen) {
						return;
					}
					utteranceOpen = true;
					current.send({ realtimeInput: { activityStart: {} } });
				},
				endUtterance() {
					if (closed) {
						return;
					}
					flushAudio();
					if (config.turnDetection === "manual") {
						if (!utteranceOpen) {
							return;
						}
						utteranceOpen = false;
						current.send({ realtimeInput: { activityEnd: {} } });
						if (rotateAfterUtterance) {
							rotateAfterUtterance = false;
							rotate();
						}
						return;
					}
					current.send({ realtimeInput: { audioStreamEnd: true } });
				},
				events: queue.iterate(),
				close() {
					if (closed) {
						return;
					}
					closed = true;
					clearTimeout(capTimer);
					queue.end();
					current.retired = true;
					current.socket.close(1000);
				},
			};
		},
	};
}
