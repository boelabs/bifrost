import { resolveQuality, withResolvedQuality } from "./qualityResolution.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const upToHigh = ["low", "medium", "high"] as const;

test("quality resolution: `drop` snaps and records what it changed", () => {
	assert.deepEqual(resolveQuality("max", upToHigh, "drop"), {
		quality: "high",
		adjustedFrom: "max",
	});
	// Nothing to report when the model already speaks the requested rung.
	assert.deepEqual(resolveQuality("medium", upToHigh, "drop"), {
		quality: "medium",
	});
	// No knob at all: the parameter is removed, and that is still an adjustment.
	assert.deepEqual(resolveQuality("high", undefined, "drop"), {
		quality: undefined,
		adjustedFrom: "high",
	});
});

test("quality resolution: `allow` forwards verbatim, `error` trusts validation", () => {
	for (const strategy of ["allow", "error"] as const) {
		assert.deepEqual(resolveQuality("max", upToHigh, strategy), {
			quality: "max",
		});
		assert.deepEqual(resolveQuality("max", undefined, strategy), {
			quality: "max",
		});
	}
});

test("quality resolution: `auto` and an omitted quality send nothing, under every strategy", () => {
	for (const strategy of ["drop", "allow", "error"] as const) {
		assert.deepEqual(resolveQuality("auto", upToHigh, strategy), {
			quality: undefined,
		});
		assert.deepEqual(resolveQuality(undefined, upToHigh, strategy), {
			quality: undefined,
		});
	}
});

test("quality resolution: the request is only copied when the rung actually changes", () => {
	const request = { prompt: "p", quality: "medium" as const };
	const untouched = withResolvedQuality(request, upToHigh, "drop");
	assert.equal(
		untouched.request,
		request,
		"same reference when nothing changes",
	);

	const snapped = withResolvedQuality(
		{ prompt: "p", quality: "max" as const },
		upToHigh,
		"drop",
	);
	assert.equal(snapped.request.quality, "high");
	assert.equal(snapped.resolved.adjustedFrom, "max");

	// Deleted, not set to undefined, so `exactOptionalPropertyTypes` and the
	// transports' `!== undefined` checks agree that nothing should be sent.
	const dropped = withResolvedQuality(
		{ prompt: "p", quality: "max" as const },
		undefined,
		"drop",
	);
	assert.equal("quality" in dropped.request, false);
});
