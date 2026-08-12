import { periodSeconds } from "./period.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("periodSeconds maps reset periods", () => {
	assert.equal(periodSeconds("hourly"), 3600);
	assert.equal(periodSeconds("daily"), 86_400);
	assert.equal(periodSeconds("weekly"), 604_800);
	assert.equal(periodSeconds("monthly"), 2_592_000);
	assert.equal(periodSeconds(null), 0);
});
