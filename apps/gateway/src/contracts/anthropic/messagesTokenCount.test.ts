import { estimateMessagesInputTokens } from "./messagesTokenCount.ts";
import { messagesTokenCountRequestSchema } from "./messages.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("Messages token count accepts the official input shape without max_tokens", () => {
	const parsed = messagesTokenCountRequestSchema.parse({
		model: "claude",
		system: "Be concise.",
		messages: [{ role: "user", content: "Hello" }],
		tools: [{ name: "lookup", input_schema: { type: "object" } }],
	});
	assert.equal(parsed.model, "claude");
	assert.equal(parsed.messages.length, 1);
});

test("portable token estimation is model-independent and accounts for tools", () => {
	const base = messagesTokenCountRequestSchema.parse({
		model: "model-a",
		messages: [{ role: "user", content: "Hello" }],
	});
	const renamed = { ...base, model: "a-much-longer-model-name" };
	const withTools = {
		...base,
		tools: [{ name: "lookup", input_schema: { type: "object" } }],
	};
	assert.equal(
		estimateMessagesInputTokens(base),
		estimateMessagesInputTokens(renamed),
	);
	assert.ok(
		estimateMessagesInputTokens(withTools) > estimateMessagesInputTokens(base),
	);
});

test("Messages token count rejects an empty conversation", () => {
	assert.throws(() =>
		messagesTokenCountRequestSchema.parse({ model: "claude", messages: [] }),
	);
});
