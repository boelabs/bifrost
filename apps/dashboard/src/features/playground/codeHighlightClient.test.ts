import { createHighlightClient } from "./codeHighlightClient";
import assert from "node:assert/strict";
import { test } from "node:test";

import type {
	HighlightRequest,
	HighlightResult,
	HighlightReply,
} from "./codeHighlight";

function fakeWorker() {
	const sent: (HighlightRequest | { release: number })[] = [];
	const worker = {
		onmessage: null as ((event: MessageEvent<HighlightReply>) => void) | null,
		onerror: null as ((event: ErrorEvent) => void) | null,
		postMessage: (request: HighlightRequest | { release: number }) => {
			sent.push(request);
		},
		terminate() {
			this.terminated = true;
		},
		terminated: false,
	};
	return {
		worker,
		sent,
		reply: (id: number, text: string, startLine = 0) =>
			worker.onmessage?.(
				new MessageEvent("message", {
					data: { id, startLine, lines: [{ text, tokens: [] }] },
				}),
			),
	};
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 80));

test("highlight queue coalesces updates and preserves the final chunk", async () => {
	const { worker, sent, reply } = fakeWorker();
	const client = createHighlightClient(() => worker);
	const results: HighlightResult[] = [];
	const subscription = client.subscribe((result) => results.push(result));
	try {
		subscription.update("a", "ts");
		subscription.update("ab", "ts");
		await tick();
		assert.deepEqual(sent, [{ id: 1, code: "ab", language: "ts" }]);
		for (let i = 0; i < 100; i++) {
			subscription.update(`ab\n${i}`, "ts");
		}
		await tick();
		assert.equal(sent.length, 1);
		reply(1, "ab");
		await tick();
		assert.deepEqual(sent[1], { id: 1, code: "ab\n99", language: "ts" });
		reply(1, "99", 1);
		assert.equal(
			results[1]?.lines.map((line) => line.text).join("\n"),
			"ab\n99",
		);
		assert.equal(results[1]?.lines[0], results[0]?.lines[0]);
	} finally {
		subscription.release();
	}
	assert.equal(worker.terminated, true);
});

test("releasing blocks drops callbacks and does not starve other blocks", async () => {
	const { worker, sent, reply } = fakeWorker();
	const client = createHighlightClient(() => worker);
	let calls = 0;
	const first = client.subscribe(() => {
		calls++;
	});
	const second = client.subscribe(() => {
		calls++;
	});
	first.update("old", "ts");
	await tick();
	second.update("other", "python");
	first.update("new", "ts");
	first.release();
	assert.equal(worker.terminated, false);
	reply(1, "old");
	assert.equal(calls, 0);
	await tick();
	assert.deepEqual(sent.at(-1), { id: 2, code: "other", language: "python" });
	reply(2, "other");
	assert.equal(calls, 1);
	second.release();
	assert.equal(worker.terminated, true);
});

test("unavailable workers fail without throwing and retry after the session ends", async () => {
	let attempts = 0;
	const client = createHighlightClient(() => {
		attempts++;
		throw new Error("Worker unavailable");
	});
	const first = client.subscribe(() => assert.fail("No highlight expected"));
	first.update("text", "ts");
	await tick();
	first.update("more", "ts");
	await tick();
	assert.equal(attempts, 1);
	first.release();
	const next = client.subscribe(() => {});
	next.update("new session", "ts");
	await tick();
	assert.equal(attempts, 2);
	next.release();
});
