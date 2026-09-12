import { truncateJson, type TruncateStats } from "./truncate.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("truncateJson: trims long strings and leaves short ones intact", () => {
	const out = truncateJson({ a: "x".repeat(20), b: "ok" }, 5) as {
		a: string;
		b: string;
	};
	assert.ok(out.a.startsWith("xxxxx...[truncated 15 chars]"));
	assert.equal(out.b, "ok");
});

test("truncateJson: stats accumulates omitted fields and characters (recursive)", () => {
	const stats: TruncateStats = { fields: 0, omittedChars: 0 };
	truncateJson(
		{
			prompt: "a".repeat(12),
			nested: { deep: "b".repeat(8) },
			list: ["c".repeat(10), "short"],
		},
		5,
		stats,
	);
	// 3 strings exceed maxLen (12, 8, 10); "short" does not.
	assert.equal(stats.fields, 3);
	assert.equal(stats.omittedChars, 7 + 3 + 5); // (12-5)+(8-5)+(10-5)
});

test("truncateJson: without truncation leaves stats at zero", () => {
	const stats: TruncateStats = { fields: 0, omittedChars: 0 };
	truncateJson({ a: "ok", b: 123, c: null }, 10, stats);
	assert.equal(stats.fields, 0);
	assert.equal(stats.omittedChars, 0);
});
