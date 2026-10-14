import { attachAdapterDiagnostics } from "#adapters/diagnostics.ts";
import type { CanonicalChatStreamChunk } from "#core/canonical.ts";
import type { AdapterDiagnostics } from "#adapters/types.ts";
import { GatewayError } from "#core/errors.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
	terminalForChatResponse,
	chatResponseAnomalies,
	observeChatStream,
} from "./streamLifecycle.ts";

const chunk = (
	content: string | undefined,
	finishReason: "stop" | "tool_calls" | "content_filter" | null = null,
): CanonicalChatStreamChunk => ({
	id: "response-1",
	created: 1,
	model: "model",
	choices: [
		{
			index: 0,
			delta: content === undefined ? {} : { content },
			finishReason,
		},
	],
});

async function drain<T>(items: AsyncIterable<T>): Promise<T[]> {
	const values: T[] = [];
	for await (const item of items) {
		values.push(item);
	}
	return values;
}

const ended = (): AdapterDiagnostics => ({
	transportTerminator: "done_marker",
});

function anomalies(diagnostics: AdapterDiagnostics | undefined): unknown {
	return diagnostics?.metadata?.anomalies ?? [];
}

describe("observeChatStream", () => {
	test("emits one terminal chunk last and records content timing", async () => {
		async function* source() {
			yield chunk("hello");
			yield chunk(undefined, "stop");
		}
		const observed = observeChatStream(source(), ended());
		const values = await drain(observed.items);
		// The finish-only frame is folded into the terminal chunk instead of repeating as an empty one.
		assert.deepEqual(
			values.map((value) => value.choices[0]?.finishReason),
			[null, "stop"],
		);
		assert.equal(observed.observation.contentFrames, 1);
		assert.deepEqual(observed.observation.terminal, {
			outcome: "completed",
			reason: "stop",
			usage: null,
		});
		assert.deepEqual(anomalies(observed.observation.diagnostics), []);
	});

	test("a finished stream without [DONE] is complete", async () => {
		async function* source() {
			yield chunk("hello");
			yield chunk(undefined, "stop");
		}
		const observed = observeChatStream(source(), {});
		await drain(observed.items);
		assert.equal(observed.observation.terminal?.outcome, "completed");
		assert.equal(observed.observation.transportTerminator, "eof");
	});

	test("an ended stream without a finish reason is complete, and says so", async () => {
		async function* source() {
			yield chunk("hello");
		}
		const observed = observeChatStream(source(), ended());
		const values = await drain(observed.items);
		assert.equal(values.at(-1)?.choices[0]?.finishReason, "stop");
		assert.equal(observed.observation.terminal?.reason, "stop");
		assert.deepEqual(anomalies(observed.observation.diagnostics), [
			"missing_finish_reason",
		]);
	});

	test("a stream cut before any finish or end marker is truncated", async () => {
		async function* source() {
			yield chunk("partial");
		}
		await assert.rejects(
			() => drain(observeChatStream(source(), {}).items),
			(error: unknown) =>
				GatewayError.is(error) &&
				error.code === "upstream_stream_truncated" &&
				error.retryable,
		);
	});

	test("a stream with no choice at all is a protocol error", async () => {
		async function* source(): AsyncGenerator<CanonicalChatStreamChunk> {
			yield { id: "x", created: 1, model: "m", choices: [] };
		}
		await assert.rejects(
			() => drain(observeChatStream(source(), ended()).items),
			(error: unknown) =>
				GatewayError.is(error) && error.code === "upstream_protocol_error",
		);
	});

	test("coalesces repeated compatible terminal evidence", async () => {
		async function* source() {
			yield chunk("complete");
			yield chunk(undefined, "stop");
			yield {
				...chunk(undefined, "stop"),
				usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
			};
		}
		const observed = observeChatStream(source(), ended());
		const values = await drain(observed.items);
		assert.equal(
			values.filter((value) => value.choices[0]?.finishReason !== null).length,
			1,
		);
		assert.equal(observed.observation.usageFrames, 1);
		assert.deepEqual(observed.observation.terminal, {
			outcome: "completed",
			reason: "stop",
			usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
		});
	});

	test("conflicting finish reasons keep the last one and are recorded", async () => {
		async function* source() {
			yield chunk("text", "stop");
			yield chunk(undefined, "content_filter");
		}
		const observed = observeChatStream(source(), ended());
		await drain(observed.items);
		assert.equal(observed.observation.terminal?.reason, "content_filter");
		assert.deepEqual(anomalies(observed.observation.diagnostics), [
			"conflicting_finish_reason",
		]);
	});

	test("holds provisional terminal evidence until trailing output ends", async () => {
		async function* source() {
			yield chunk(undefined, "stop");
			yield chunk("late output");
		}
		const values = await drain(observeChatStream(source(), ended()).items);
		assert.deepEqual(
			values.map((value) => value.choices[0]?.finishReason),
			[null, "stop"],
		);
	});

	test("normalizes a provisional stop followed by a tool call", async () => {
		async function* source() {
			yield chunk(undefined, "stop");
			yield {
				...chunk(undefined),
				choices: [
					{
						index: 0,
						delta: {
							toolCalls: [
								{
									index: 0,
									id: "call-1",
									name: "search_web",
									arguments: "{}",
								},
							],
						},
						finishReason: null,
					},
				],
			};
		}
		const observed = observeChatStream(source(), ended());
		const values = await drain(observed.items);
		assert.equal(values.at(-1)?.choices[0]?.finishReason, "tool_calls");
		assert.deepEqual(observed.observation.terminal, {
			outcome: "completed",
			reason: "tool_calls",
			usage: null,
		});
	});

	test("an empty answer is the upstream's answer, not a failure", async () => {
		async function* source() {
			yield chunk(undefined, "stop");
		}
		const observed = observeChatStream(source(), ended());
		await drain(observed.items);
		assert.equal(observed.observation.terminal?.outcome, "completed");
		assert.deepEqual(anomalies(observed.observation.diagnostics), [
			"empty_output",
		]);
	});

	test("preserves an adapter's explicit incomplete outcome", async () => {
		async function* source() {
			yield chunk("partial");
			yield attachAdapterDiagnostics(chunk(undefined, "content_filter"), {
				originalTerminalReason: "content_filter",
				terminal: { outcome: "incomplete", reason: "content_filter" },
			});
		}
		const observed = observeChatStream(source(), ended());
		await drain(observed.items);
		assert.deepEqual(observed.observation.terminal, {
			outcome: "incomplete",
			reason: "content_filter",
			usage: null,
		});
	});

	test("long silences between frames are not the observer's concern", async () => {
		async function* source() {
			yield chunk("first");
			await new Promise<void>((resolve) => setTimeout(resolve, 30));
			yield chunk("second", "stop");
		}
		const observed = observeChatStream(source(), ended());
		await drain(observed.items);
		assert.equal(observed.observation.terminal?.outcome, "completed");
		assert.ok(observed.observation.maxInterEventGapMs >= 25);
	});
});

describe("terminalForChatResponse", () => {
	const response = (
		message: Record<string, unknown>,
		finishReason: "stop" | "tool_calls" | null,
	) => ({
		id: "response-1",
		created: 1,
		model: "model",
		choices: [
			{
				index: 0,
				finishReason,
				message: { role: "assistant" as const, content: null, ...message },
			},
		],
		usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
	});

	test("an empty completion is completed and recorded as such", () => {
		const empty = response({}, "stop");
		assert.equal(terminalForChatResponse(empty).outcome, "completed");
		assert.deepEqual(chatResponseAnomalies(empty), ["empty_output"]);
	});

	test("a missing finish reason is read from the output", () => {
		const text = response({ content: "hi" }, null);
		assert.equal(terminalForChatResponse(text).reason, "stop");
		assert.deepEqual(chatResponseAnomalies(text), ["missing_finish_reason"]);
		const tool = response(
			{ toolCalls: [{ id: "c", name: "f", arguments: "{}" }] },
			null,
		);
		assert.equal(terminalForChatResponse(tool).reason, "tool_calls");
	});

	test("a response without choices is a protocol error", () => {
		assert.throws(
			() =>
				terminalForChatResponse({
					id: "r",
					created: 1,
					model: "m",
					choices: [],
					usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
				}),
			(error: unknown) =>
				GatewayError.is(error) && error.code === "upstream_protocol_error",
		);
	});
});
