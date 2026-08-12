import assert from "node:assert/strict";
import { test } from "node:test";

import {
	expandLocalCompactionItems,
	encodeCompactionSummary,
	decodeCompactionSummary,
} from "./responseCompaction.ts";

test("compaction capsule: encrypted summaries round-trip without server state", () => {
	const encrypted = encodeCompactionSummary("Keep the selected constraints.");
	assert.notEqual(encrypted, "Keep the selected constraints.");
	assert.equal(
		decodeCompactionSummary(encrypted),
		"Keep the selected constraints.",
	);
});

test("compaction capsule: local items expand while foreign items stay opaque", () => {
	const local = encodeCompactionSummary("Continue from the verified result.");
	assert.deepEqual(
		expandLocalCompactionItems([
			{ type: "compaction", encrypted_content: local },
			{ type: "compaction", encrypted_content: "foreign" },
		]),
		[
			{
				type: "message",
				role: "developer",
				content: [
					{
						type: "input_text",
						text: "Continue from the verified result.",
					},
				],
			},
			{ type: "compaction", encrypted_content: "foreign" },
		],
	);
});
