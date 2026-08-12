import type { CanonicalChatStreamChunk } from "#core/canonical.ts";
import { tapFirstToken } from "./ttft.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function chunk(
	delta: CanonicalChatStreamChunk["choices"][number]["delta"],
): CanonicalChatStreamChunk {
	return {
		id: "c",
		created: 1,
		model: "m",
		choices: [{ index: 0, delta, finishReason: null }],
	};
}

async function drain(
	gen: AsyncIterable<CanonicalChatStreamChunk>,
): Promise<number> {
	let n = 0;
	for await (const _ of gen) n++;
	return n;
}

test("tapFirstToken: fires on the first chunk with text content", async () => {
	const src = (async function* () {
		yield chunk({ role: "assistant" });
		yield chunk({ content: "Hel" });
		yield chunk({ content: "lo" });
	})();
	let firedAt: number | null = null;
	let calls = 0;
	const count = await drain(
		tapFirstToken(src, (at) => {
			firedAt = at;
			calls++;
		}),
	);
	assert.equal(count, 3);
	assert.equal(calls, 1);
	assert.ok(firedAt && firedAt > 0);
});

test("tapFirstToken: fires with tool call even without text (old /responses gap)", async () => {
	const src = (async function* () {
		yield chunk({ role: "assistant" });
		yield chunk({
			toolCalls: [{ index: 0, id: "c1", name: "f", arguments: "" }],
		});
		yield chunk({ toolCalls: [{ index: 0, arguments: '{"x":1}' }] });
	})();
	let calls = 0;
	await drain(tapFirstToken(src, () => calls++));
	assert.equal(calls, 1);
});

test("tapFirstToken: fires with visible reasoning", async () => {
	const src = (async function* () {
		yield chunk({ role: "assistant" });
		yield chunk({ reasoning: "hmm" });
		yield chunk({ content: "ok" });
	})();
	let calls = 0;
	await drain(tapFirstToken(src, () => calls++));
	assert.equal(calls, 1);
});

test("tapFirstToken: does not fire if there is never a real token", async () => {
	const src = (async function* () {
		yield chunk({ role: "assistant" });
		yield chunk({});
	})();
	let calls = 0;
	await drain(tapFirstToken(src, () => calls++));
	assert.equal(calls, 0);
});
