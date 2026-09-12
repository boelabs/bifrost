import { responsesEventsToCanonicalChunks } from "#contracts/openai/responsesTransport.ts";
import { observeResponsesProgress } from "./responsesProgress.ts";
import { adapterDiagnostics } from "./diagnostics.ts";
import type { SSEEvent } from "#core/sse.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const events = [
	{
		type: "response.output_item.added",
		item: { id: "r1", type: "reasoning", summary: [] },
	},
	{
		type: "response.output_item.done",
		item: {
			id: "r1",
			type: "reasoning",
			summary: [],
			encrypted_content: "opaque-fixture",
		},
	},
	{
		type: "response.output_item.done",
		item: {
			id: "r1",
			type: "reasoning",
			summary: [],
			encrypted_content: "opaque-fixture",
		},
	},
	{
		type: "response.output_item.done",
		item: { id: "t1", type: "web_search_call", status: "completed" },
	},
	{ type: "response.in_progress", response: { id: "response" } },
	{
		type: "response.completed",
		response: { id: "response", status: "completed", output: [] },
	},
];
test("Responses item progress survives parsing without inventing visible reasoning", async () => {
	async function* source(): AsyncGenerator<SSEEvent> {
		for (const event of events)
			yield { event: event.type, data: JSON.stringify(event) };
	}
	const seen = [];
	for await (const chunk of observeResponsesProgress(
		responsesEventsToCanonicalChunks(source()),
	)) {
		seen.push(adapterDiagnostics(chunk)?.progress);
		assert.ok(chunk.choices.every((choice) => !choice.delta.reasoning));
	}
	assert.deepEqual(seen.filter(Boolean), ["reasoning", "reasoning", "tool"]);
});
