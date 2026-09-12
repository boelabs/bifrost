import assert from "node:assert/strict";
import { test } from "node:test";

import {
	dollarsPerMillionToCentsPerMillion,
	dollarsPerTokenToCentsPerMillion,
	pricingFromDollarStrings,
} from "./pricing.ts";

test("dollarsPerTokenToCentsPerMillion converts dollars-per-token strings to cents-per-million", () => {
	assert.equal(dollarsPerTokenToCentsPerMillion("0.000002"), 200);
	assert.equal(dollarsPerTokenToCentsPerMillion("0.00001"), 1000);
	assert.equal(dollarsPerTokenToCentsPerMillion(undefined), undefined);
	assert.equal(dollarsPerTokenToCentsPerMillion(""), undefined);
	assert.equal(dollarsPerTokenToCentsPerMillion("not-a-number"), undefined);
});

test("dollarsPerMillionToCentsPerMillion converts models.dev's already-per-million dollars", () => {
	assert.equal(dollarsPerMillionToCentsPerMillion(1.25), 125);
	assert.equal(dollarsPerMillionToCentsPerMillion(10), 1000);
	assert.equal(dollarsPerMillionToCentsPerMillion(0), 0);
	assert.equal(dollarsPerMillionToCentsPerMillion(undefined), undefined);
});

test("the two pricing conventions agree on the same real-world price expressed either way", () => {
	// GPT-5 costs $1.25/M input tokens == $0.00000125/token - both conversions must land on 125 cents/M.
	assert.equal(
		dollarsPerMillionToCentsPerMillion(1.25),
		dollarsPerTokenToCentsPerMillion("0.00000125"),
	);
});

test("pricingFromDollarStrings builds only the fields present, omitting undefined ones", () => {
	assert.deepEqual(
		pricingFromDollarStrings({ prompt: "0.000002", completion: "0.00001" }),
		{ inputCentsPerMTokens: 200, outputCentsPerMTokens: 1000 },
	);
	assert.equal(pricingFromDollarStrings(undefined), undefined);
	assert.equal(pricingFromDollarStrings({}), undefined);
});
