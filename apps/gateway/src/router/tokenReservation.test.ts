import { estimateTokenReservation } from "./tokenReservation.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("token reservation conservatively combines UTF-8 input and output bounds", () => {
	const payload = { input: "é" };
	assert.equal(
		estimateTokenReservation(payload, {
			maxOutputTokens: 10,
			additionalInputTokens: 20,
		}),
		Buffer.byteLength(JSON.stringify(payload), "utf8") + 30,
	);
});

test("token reservation ignores invalid optional bounds", () => {
	assert.equal(estimateTokenReservation(null, { maxOutputTokens: -1 }), 4);
});
