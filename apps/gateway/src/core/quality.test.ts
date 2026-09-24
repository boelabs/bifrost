import { normalizeQuality, snapQuality } from "./quality.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("quality: legacy vocabularies normalize onto the ladder", () => {
	assert.equal(normalizeQuality("standard"), "medium");
	assert.equal(normalizeQuality("hd"), "high");
	assert.equal(normalizeQuality("native"), "max");
	// Canonical values pass through untouched, including `auto`.
	for (const value of [
		"auto",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	] as const) {
		assert.equal(normalizeQuality(value), value);
	}
});

test("quality: a declared rung is kept and anything above the top lands on it", () => {
	const full = ["low", "medium", "high", "xhigh", "max"] as const;
	for (const level of full) {
		assert.equal(snapQuality(level, full), level);
	}

	// A model that stops at high: everything above it lands on high.
	const upToHigh = ["low", "medium", "high"] as const;
	assert.equal(snapQuality("xhigh", upToHigh), "high");
	assert.equal(snapQuality("max", upToHigh), "high");
	assert.equal(snapQuality("medium", upToHigh), "medium");
});

test("quality: a missing rung snaps to the nearest one, lower on a tie", () => {
	// The case the design is named for: low/high, with no medium.
	const lowHigh = ["low", "high"] as const;
	assert.equal(snapQuality("max", lowHigh), "high");
	assert.equal(snapQuality("xhigh", lowHigh), "high");
	assert.equal(snapQuality("medium", lowHigh), "low");
	assert.equal(snapQuality("low", lowHigh), "low");

	// Below every rung: snap UP to the model's floor rather than failing.
	const highOnly = ["high", "max"] as const;
	assert.equal(snapQuality("low", highOnly), "high");
	assert.equal(snapQuality("medium", highOnly), "high");

	// Nearest in either direction: xhigh is one rung below max and two above medium.
	assert.equal(snapQuality("xhigh", ["low", "medium", "max"]), "max");
	assert.equal(snapQuality("high", ["low", "max"]), "low");
	// Declaration order must not matter.
	assert.equal(snapQuality("xhigh", ["max", "low", "medium"]), "max");
});

test("quality: a model with no rungs has no knob to snap to", () => {
	assert.equal(snapQuality("high", undefined), undefined);
	assert.equal(snapQuality("high", []), undefined);
});
