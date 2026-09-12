import { usesAnthropicErrorDialect } from "./errorDialect.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("Messages routes use the Anthropic error dialect", () => {
	assert.equal(usesAnthropicErrorDialect("/v1/messages"), true);
	assert.equal(usesAnthropicErrorDialect("/v1/messages/count_tokens"), true);
	assert.equal(usesAnthropicErrorDialect("/v1/messages-batch"), false);
	assert.equal(usesAnthropicErrorDialect("/v1/chat/completions"), false);
});
