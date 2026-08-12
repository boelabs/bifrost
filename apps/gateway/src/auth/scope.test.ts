import type { Auth, VirtualKeyAuth } from "./types.ts";
import { assertModelAllowed } from "./scope.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function vk(allowedModels: string[]): Auth {
	const key: VirtualKeyAuth = {
		id: "1",
		name: "k",
		allowedModels,
		enabled: true,
		expiresAt: null,
		maxBudgetCents: null,
		budgetReset: null,
		budgetResetAt: null,
		spendCents: 0,
		tpm: null,
		rpm: null,
	};
	return { type: "virtual", key };
}

test("master can use any public model", () => {
	assert.doesNotThrow(() =>
		assertModelAllowed({ type: "master" }, "lo-que-sea"),
	);
});

test("virtual with allowedModels=[] can use any public model", () => {
	assert.doesNotThrow(() => assertModelAllowed(vk([]), "gemini"));
});

test("restricted virtual key: allows listed models, rejects the rest", () => {
	assert.doesNotThrow(() =>
		assertModelAllowed(vk(["gpt", "gemini"]), "gemini"),
	);
	assert.throws(
		() => assertModelAllowed(vk(["gpt"]), "gemini"),
		/does not have access/,
	);
});

test("rejection is permission class (403)", () => {
	try {
		assertModelAllowed(vk(["gpt"]), "claude");
		assert.fail("should have thrown");
	} catch (err) {
		assert.equal((err as { class?: string }).class, "permission");
		assert.equal((err as { httpStatus?: number }).httpStatus, 403);
	}
});
