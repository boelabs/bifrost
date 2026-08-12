import assert from "node:assert/strict";
import { parseSSE } from "./sse.ts";
import { test } from "node:test";

const streamOf = (text: string): ReadableStream<Uint8Array> =>
	new Response(text).body!;

test("parseSSE: events with event/data, multiline data, and comments", async () => {
	const sse =
		": keep-alive\n\n" +
		"event: foo\ndata: hello\n\n" +
		"data: line1\ndata: line2\n\n";
	const out = [];
	for await (const ev of parseSSE(streamOf(sse))) out.push(ev);
	assert.deepEqual(out, [
		{ event: "foo", data: "hello" },
		{ data: "line1\nline2" },
	]);
});

test("parseSSE: tolerates CRLF and flushes the last event without a final blank line", async () => {
	const out = [];
	for await (const ev of parseSSE(streamOf("data: a\r\n\r\ndata: b\r\n")))
		out.push(ev.data);
	assert.deepEqual(out, ["a", "b"]);
});

test("parseSSE: UTF-8 split across chunks is not corrupted", async () => {
	const bytes = new TextEncoder().encode("data: ☺\n\n");
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			// Splits the multibyte character (☺ = 3 bytes) across two chunks.
			controller.enqueue(bytes.slice(0, 7));
			controller.enqueue(bytes.slice(7));
			controller.close();
		},
	});
	const out = [];
	for await (const ev of parseSSE(stream)) out.push(ev.data);
	assert.deepEqual(out, ["☺"]);
});

test("parseSSE: cancels upstream stream if the consumer cuts early", async () => {
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode("data: a\n\ndata: b\n\n"));
			// Not closed: simulates an upstream stream that is still open.
		},
		cancel() {
			cancelled = true;
		},
	});
	for await (const ev of parseSSE(stream)) {
		if (ev.data === "a") break; // cuts early, before consuming "b"
	}
	assert.equal(cancelled, true, "must propagate cancel() upstream");
});
