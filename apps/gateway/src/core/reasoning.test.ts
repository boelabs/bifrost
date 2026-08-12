import assert from "node:assert/strict";
import { test } from "node:test";

import {
	resolveBodyFieldReasoning,
	toUpstreamReasoningEffort,
	resolveChatTemplateFlag,
	effortFromBudgetTokens,
	type ReasoningSpec,
	reasoningLogInfo,
	resolveReasoning,
	summaryForEffort,
	summaryVisible,
	snapEffort,
} from "./reasoning.ts";

test("snapEffort: none is honored only if the model exposes an off switch (none in levels)", () => {
	const withOff: ReasoningSpec = {
		kind: "openai_effort",
		levels: ["none", "low", "medium", "high"],
	};
	const alwaysReasons: ReasoningSpec = {
		kind: "gemini_level",
		levels: ["low", "medium", "high"],
	};
	assert.equal(snapEffort("none", withOff), "none");
	assert.equal(snapEffort("none", alwaysReasons), "low"); // snaps up to the floor
	// A positive request never rounds DOWN into off, even when off exists.
	assert.equal(snapEffort("minimal", withOff), "low");
});

test("snapEffort: lowers to the nearest supported level", () => {
	const spec: ReasoningSpec = {
		kind: "anthropic_adaptive",
		levels: ["none", "low", "medium", "high"],
	};
	assert.equal(snapEffort("xhigh", spec), "high");
	assert.equal(snapEffort("max", spec), "high");
	assert.equal(snapEffort("minimal", spec), "low");
});

test("snapEffort: preserves max as a distinct tier above xhigh", () => {
	const full: ReasoningSpec = {
		kind: "openai_effort",
		levels: ["none", "high", "xhigh", "max"],
	};
	assert.equal(snapEffort("xhigh", full), "xhigh");
	assert.equal(snapEffort("max", full), "max");

	const highOrMax: ReasoningSpec = {
		kind: "openai_effort",
		levels: ["none", "high", "max"],
	};
	assert.equal(snapEffort("xhigh", highOrMax), "high");
	assert.equal(snapEffort("max", highOrMax), "max");
});

test("snapEffort: a binary toggle normalizes exclusively to none/high", () => {
	const spec: ReasoningSpec = {
		kind: "openai_effort",
		levels: ["none", "high"],
	};
	assert.equal(snapEffort("none", spec), "none");
	for (const effort of [
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	] as const) {
		assert.equal(snapEffort(effort, spec), "high");
	}
});

test("reasoningLogInfo: reports requested vs effective and flags clamping", () => {
	const flashLite: ReasoningSpec = {
		kind: "gemini_level",
		levels: ["minimal", "low", "medium", "high"],
	};
	const withOff: ReasoningSpec = {
		kind: "openai_effort",
		levels: ["none", "low", "medium", "high"],
	};
	// "none" clamps up to the floor on a mandatory reasoner.
	assert.deepEqual(reasoningLogInfo({ effort: "none" }, flashLite), {
		requested: "none",
		effective: "minimal",
		clamped: true,
		source: "clamped",
	});
	// Honored as-is when the model has an off switch.
	assert.deepEqual(reasoningLogInfo({ effort: "none" }, withOff), {
		requested: "none",
		effective: "none",
		clamped: false,
		source: "client",
	});
	// Out-of-range request clamps down.
	assert.deepEqual(reasoningLogInfo({ effort: "xhigh" }, flashLite), {
		requested: "xhigh",
		effective: "high",
		clamped: true,
		source: "clamped",
	});
	assert.deepEqual(reasoningLogInfo(undefined, flashLite), {
		requested: null,
		effective: "minimal",
		clamped: false,
		source: "model_floor",
	});
	assert.equal(reasoningLogInfo({ effort: "high" }, undefined), undefined);
});

test("effortFromBudgetTokens: buckets legacy budgets", () => {
	assert.equal(effortFromBudgetTokens(0), "none");
	assert.equal(effortFromBudgetTokens(2_048), "low");
	assert.equal(effortFromBudgetTokens(10_000), "medium");
	assert.equal(effortFromBudgetTokens(32_000), "xhigh");
	assert.equal(effortFromBudgetTokens(1_000_000), "xhigh");
});

test("toUpstreamReasoningEffort: maps synonymous labels without conflating xhigh and max", () => {
	const spec: ReasoningSpec = {
		kind: "openai_effort",
		levels: ["none", "high", "xhigh", "max"],
		upstreamEffortMap: { max: "maximum" },
	};
	assert.equal(toUpstreamReasoningEffort("high", spec), "high");
	assert.equal(toUpstreamReasoningEffort("xhigh", spec), "xhigh");
	assert.equal(toUpstreamReasoningEffort("max", spec), "maximum");
});

test("resolveChatTemplateFlag: binary on/off toggle against the spec", () => {
	const spec: ReasoningSpec = {
		kind: "chat_template_flag",
		levels: ["none", "high"],
		chatTemplateFlag: { param: "thinking" },
	};
	// omitted effort on a model that can disable -> off -> no offValue -> no output.
	assert.equal(resolveChatTemplateFlag(undefined, spec), undefined);
	// any non-none effort -> on -> default onValue true.
	assert.deepEqual(resolveChatTemplateFlag({ effort: "low" }, spec), {
		param: "thinking",
		value: true,
	});
	assert.deepEqual(resolveChatTemplateFlag({ effort: "high" }, spec), {
		param: "thinking",
		value: true,
	});
});

test("resolveChatTemplateFlag: respects custom onValue/offValue and parameter name", () => {
	const spec: ReasoningSpec = {
		kind: "chat_template_flag",
		levels: ["none", "high"],
		chatTemplateFlag: {
			param: "enable_thinking",
			onValue: "on",
			offValue: "off",
		},
	};
	assert.deepEqual(resolveChatTemplateFlag({ effort: "high" }, spec), {
		param: "enable_thinking",
		value: "on",
	});
	assert.deepEqual(resolveChatTemplateFlag({ effort: "none" }, spec), {
		param: "enable_thinking",
		value: "off",
	});
});

test("resolveChatTemplateFlag: undefined for other kinds", () => {
	const spec: ReasoningSpec = {
		kind: "openai_effort",
		levels: ["none", "high"],
	};
	assert.equal(resolveChatTemplateFlag({ effort: "high" }, spec), undefined);
});

test("resolveBodyFieldReasoning: emits top-level JSON values for OpenAI-compatible", () => {
	const spec: ReasoningSpec = {
		kind: "openai_body",
		levels: ["none", "high"],
		bodyField: {
			param: "thinking",
			onValue: { type: "enabled" },
			offValue: { type: "disabled" },
		},
	};
	assert.deepEqual(resolveBodyFieldReasoning(undefined, spec), {
		param: "thinking",
		value: { type: "disabled" },
	});
	assert.deepEqual(resolveBodyFieldReasoning({ effort: "low" }, spec), {
		param: "thinking",
		value: { type: "enabled" },
	});
});

test("summaryForEffort: enabled effort implies auto unless opt-out none", () => {
	assert.equal(summaryForEffort("high", undefined), "auto");
	assert.equal(summaryForEffort("high", "none"), "none");
	assert.equal(summaryForEffort("none", undefined), undefined);
});

test("resolveReasoning: omitted effort on MANDATORY reasoner -> lowest level + auto summary", () => {
	// "none" ∉ levels -> cannot avoid reasoning: default = minimum level, with thoughts.
	const spec: ReasoningSpec = {
		kind: "gemini_level",
		levels: ["low", "medium", "high"],
	};
	const resolved = resolveReasoning(undefined, spec);
	assert.equal(resolved.effort, "low");
	assert.equal(resolved.summary, "auto");
	assert.equal(summaryVisible(resolved.summary), true);
});

test("resolveReasoning: omitted effort on model that CAN skip reasoning -> none (does not reason)", () => {
	// "none" ∈ levels -> the default is no reasoning (none), without thoughts.
	const spec: ReasoningSpec = {
		kind: "openai_effort",
		levels: ["none", "low", "medium", "high"],
	};
	const resolved = resolveReasoning(undefined, spec);
	assert.equal(resolved.effort, "none");
	assert.equal(resolved.summary, undefined);
	assert.equal(summaryVisible(resolved.summary), false);
});

test("resolveReasoning: explicit effort is snapped and respects summary opt-out", () => {
	const spec: ReasoningSpec = {
		kind: "openai_effort",
		levels: ["none", "low", "medium", "high"],
	};
	const high = resolveReasoning({ effort: "xhigh" }, spec);
	assert.equal(high.effort, "high"); // snapped to the supported ceiling
	assert.equal(high.summary, "auto");

	const optOut = resolveReasoning({ effort: "medium", summary: "none" }, spec);
	assert.equal(optOut.summary, "none");
	assert.equal(summaryVisible(optOut.summary), false);

	// Client can request a specific summary.
	assert.equal(
		resolveReasoning({ effort: "low", summary: "detailed" }, spec).summary,
		"detailed",
	);
});

test("resolveReasoning: effort none on model that can disable -> no summary", () => {
	const spec: ReasoningSpec = {
		kind: "openai_effort",
		levels: ["none", "low", "medium", "high"],
	};
	const resolved = resolveReasoning({ effort: "none" }, spec);
	assert.equal(resolved.effort, "none");
	assert.equal(resolved.summary, undefined);
	assert.equal(summaryVisible(resolved.summary), false);
});
