import { DEFAULT_EXECUTION_POLICIES } from "#core/executionPolicy.ts";
import { attachAdapterDiagnostics } from "#adapters/diagnostics.ts";
import type { CanonicalChatStreamChunk } from "#core/canonical.ts";
import { GatewayError } from "#core/errors.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
	terminalForChatResponse,
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

test("default text policy allows long reasoning and silence while preserving the idle bound", async () => {
	const originalNow = Date.now;
	let clock = 0;
	Date.now = () => clock;
	try {
		async function* source() {
			clock = 150_000;
			yield attachAdapterDiagnostics(chunk(undefined), {
				progress: "reasoning",
			});
			for (let i = 0; i < 4; i++) {
				clock += 45_000;
				const item = chunk(undefined);
				item.choices[0]!.delta.reasoning = "Still working";
				yield item;
			}
			yield chunk("Answer", "stop");
		}
		const observed = observeChatStream(
			source(),
			DEFAULT_EXECUTION_POLICIES.chat.stream,
		);
		await drain(observed.items);
		assert.equal(observed.observation.reasoningFrames, 4);
		assert.equal(observed.observation.terminal?.outcome, "completed");
		async function* stalled() {
			yield chunk("started");
			clock += DEFAULT_EXECUTION_POLICIES.chat.stream.idleMs! + 1;
			yield chunk(undefined);
			yield chunk("too late", "stop");
		}
		await assert.rejects(
			() =>
				drain(
					observeChatStream(stalled(), DEFAULT_EXECUTION_POLICIES.chat.stream)
						.items,
				),
			(error: unknown) =>
				GatewayError.is(error) && error.code === "upstream_idle_timeout",
		);
	} finally {
		Date.now = originalNow;
	}
});

async function drain<T>(items: AsyncIterable<T>): Promise<T[]> {
	const values: T[] = [];
	for await (const item of items) values.push(item);
	return values;
}

describe("observeChatStream", () => {
	test("requires a semantic terminal and records content timing", async () => {
		async function* source() {
			yield chunk("hello");
			yield chunk(undefined, "stop");
		}
		const observed = observeChatStream(source());
		const values = await drain(observed.items);
		assert.deepEqual(
			values.map((value) => value.choices[0]?.finishReason),
			[null, null, "stop"],
		);
		assert.equal(observed.observation.contentFrames, 1);
		assert.deepEqual(observed.observation.terminal, {
			outcome: "completed",
			reason: "stop",
			usage: null,
		});
	});

	test("rejects EOF without a semantic terminal", async () => {
		async function* source() {
			yield chunk("partial");
		}
		const observed = observeChatStream(source());
		try {
			await drain(observed.items);
			throw new Error("expected protocol error");
		} catch (error) {
			assert.equal(GatewayError.is(error), true);
			assert.equal((error as GatewayError).code, "upstream_protocol_error");
		}
	});

	test("enforces the first useful output deadline", async () => {
		async function* source() {
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
			yield chunk("late", "stop");
		}
		const observed = observeChatStream(source(), {
			firstOutputMs: 5,
			idleMs: 5,
			reasoningOnlyMs: 20,
			preCommitMs: 20,
			totalMs: 50,
			maxAttempts: 2,
		});
		try {
			await drain(observed.items);
			throw new Error("expected timeout");
		} catch (error) {
			assert.equal(GatewayError.is(error), true);
			assert.equal(
				(error as GatewayError).code,
				"upstream_first_output_timeout",
			);
		}
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
		const observed = observeChatStream(source());
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

	test("rejects conflicting terminal evidence", async () => {
		async function* source() {
			yield chunk(undefined, "stop");
			yield chunk(undefined, "content_filter");
		}
		await assert.rejects(
			() => drain(observeChatStream(source()).items),
			(error: unknown) =>
				GatewayError.is(error) && error.code === "upstream_protocol_error",
		);
	});

	test("holds provisional terminal evidence until trailing semantic output ends", async () => {
		async function* source() {
			yield chunk(undefined, "stop");
			yield chunk("late output");
		}
		const values = await drain(observeChatStream(source()).items);
		assert.deepEqual(
			values.map((value) => value.choices[0]?.finishReason),
			[null, null, "stop"],
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
		const observed = observeChatStream(source());
		const values = await drain(observed.items);
		assert.equal(values.at(-1)?.choices[0]?.finishReason, "tool_calls");
		assert.deepEqual(observed.observation.terminal, {
			outcome: "completed",
			reason: "tool_calls",
			usage: null,
		});
	});

	test("rejects a streaming stop without semantic output", async () => {
		async function* source() {
			yield chunk(undefined, "stop");
		}
		await assert.rejects(
			() => drain(observeChatStream(source()).items),
			(error: unknown) =>
				GatewayError.is(error) && error.code === "upstream_protocol_error",
		);
	});

	test("preserves an adapter's explicit incomplete outcome", async () => {
		async function* source() {
			yield chunk("partial");
			yield attachAdapterDiagnostics(chunk(undefined, "content_filter"), {
				originalTerminalReason: "content_filter",
				terminal: { outcome: "incomplete", reason: "content_filter" },
			});
		}
		const observed = observeChatStream(source());
		await drain(observed.items);
		assert.deepEqual(observed.observation.terminal, {
			outcome: "incomplete",
			reason: "content_filter",
			usage: null,
		});
	});

	test("rejects a JSON completion that claims stop without output", () => {
		assert.throws(
			() =>
				terminalForChatResponse({
					id: "response-1",
					created: 1,
					model: "model",
					choices: [
						{
							index: 0,
							finishReason: "stop",
							message: { role: "assistant", content: null },
						},
					],
					usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
				}),
			(error: unknown) =>
				GatewayError.is(error) && error.code === "upstream_protocol_error",
		);
	});
});

test("opaque reasoning can precede the first visible output beyond the initial deadline", async () => {
	const originalNow = Date.now;
	let clock = 0;
	Date.now = () => clock;
	try {
		async function* source() {
			for (let index = 0; index < 5; index++) {
				clock += 10;
				yield attachAdapterDiagnostics(chunk(undefined), {
					progress: "reasoning",
				});
			}
			clock += 10;
			yield chunk("answer", "stop");
		}
		const observed = observeChatStream(source(), {
			firstOutputMs: 15,
			idleMs: 30,
			reasoningOnlyMs: 90,
			preCommitMs: 25,
			totalMs: 600,
			maxAttempts: 1,
		});
		await drain(observed.items);
		assert.equal(observed.observation.firstReasoningAt, null);
		assert.equal(observed.observation.firstOutputAt, 60);
		assert.equal(observed.observation.terminal?.outcome, "completed");
	} finally {
		Date.now = originalNow;
	}
});

for (const kind of ["reasoning", "tool"] as const) {
	test(`fresh opaque ${kind} progress renews idle deadlines without counting visible text`, async () => {
		const originalNow = Date.now;
		let clock = 0;
		Date.now = () => clock;
		try {
			async function* source() {
				yield chunk("initial");
				for (let i = 0; i < 5; i++) {
					clock += 20;
					yield attachAdapterDiagnostics(chunk(undefined), { progress: kind });
				}
				clock += 20;
				yield chunk("done", "stop");
			}
			const observed = observeChatStream(source(), {
				firstOutputMs: 50,
				idleMs: 50,
				reasoningOnlyMs: 500,
				preCommitMs: 50,
				totalMs: 1000,
				maxAttempts: 1,
			});
			await drain(observed.items);
			assert.equal(observed.observation.contentFrames, 2);
			assert.equal(observed.observation.reasoningFrames, 0);
			assert.equal(observed.observation.terminal?.outcome, "completed");
		} finally {
			Date.now = originalNow;
		}
	});
}

test("metadata does not renew idle deadlines", async () => {
	const originalNow = Date.now;
	let clock = 0;
	Date.now = () => clock;
	try {
		async function* source() {
			yield chunk("initial");
			for (let i = 0; i < 10; i++) {
				clock += 20;
				yield chunk(undefined);
			}
			yield chunk("late", "stop");
		}
		await assert.rejects(
			() =>
				drain(
					observeChatStream(source(), {
						firstOutputMs: 50,
						idleMs: 50,
						reasoningOnlyMs: 500,
						preCommitMs: 50,
						totalMs: 1000,
						maxAttempts: 1,
					}).items,
				),
			(error: unknown) =>
				GatewayError.is(error) && error.code === "upstream_idle_timeout",
		);
	} finally {
		Date.now = originalNow;
	}
});

test("opaque reasoning progress still respects the reasoning-only deadline", async () => {
	const originalNow = Date.now;
	let clock = 0;
	Date.now = () => clock;
	try {
		async function* source() {
			for (let i = 0; i < 10; i++) {
				clock += 20;
				yield attachAdapterDiagnostics(chunk(undefined), {
					progress: "reasoning",
				});
			}
			yield chunk("late", "stop");
		}
		await assert.rejects(
			() =>
				drain(
					observeChatStream(source(), {
						firstOutputMs: 50,
						idleMs: 50,
						reasoningOnlyMs: 70,
						preCommitMs: 50,
						totalMs: 1000,
						maxAttempts: 1,
					}).items,
				),
			(error: unknown) =>
				GatewayError.is(error) &&
				error.code === "upstream_reasoning_only_timeout",
		);
	} finally {
		Date.now = originalNow;
	}
});
