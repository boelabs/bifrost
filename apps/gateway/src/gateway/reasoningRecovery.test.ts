import { jsonResponse, withStubbedFetch } from "#test-support/fetch.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import { recoverReasoning } from "./reasoningRecovery.ts";
import { openaiAdapter } from "#adapters/openai/index.ts";
import type { AdapterContext } from "#adapters/types.ts";
import type { ReasoningSpec } from "#core/reasoning.ts";
import { GatewayError } from "#core/errors.ts";
import { executeChat } from "./executor.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function meta(reasoning: ReasoningSpec): ResolvedModelMetadata {
	return {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: true,
			structuredOutputs: true,
		},
		reasoning,
	};
}

function rejection(message: string, status = 400, param?: string) {
	return new GatewayError({
		class: "bad_request",
		message,
		status,
		...(param === undefined ? {} : { param }),
		provider: { status, body: {} },
	});
}

const OPENAI_NONE =
	"Unsupported value: 'none' is not supported with the 'gpt-x' model. Supported values are: 'low', 'medium', 'high', 'xhigh', and 'max'.";
const stale = meta({
	kind: "openai_effort",
	levels: ["none", "low", "medium", "high", "xhigh", "max"],
});

test("a rejected none snaps to the floor the provider lists", () => {
	assert.deepEqual(
		recoverReasoning(rejection(OPENAI_NONE), { effort: "none" }, stale),
		{
			rejected: "none",
			effective: "low",
			spec: {
				kind: "openai_effort",
				levels: ["low", "medium", "high", "xhigh", "max"],
			},
		},
	);
	// An omitted effort resolves to the same floor, so it recovers the same way.
	assert.equal(
		recoverReasoning(rejection(OPENAI_NONE), undefined, stale)?.effective,
		"low",
	);
});

test("the effort param alone marks an unlisted rejection as ours", () => {
	const message = "Unsupported value: 'none' is not supported with this model.";
	assert.equal(
		recoverReasoning(rejection(message), { effort: "none" }, stale),
		undefined,
	);
	assert.equal(
		recoverReasoning(
			rejection(message, 400, "reasoning.effort"),
			{ effort: "none" },
			stale,
		)?.effective,
		"low",
	);
});

test("a rejected level snaps to the nearest listed one", () => {
	const recovery = recoverReasoning(
		rejection(
			"output_config.effort: Input should be 'low', 'medium' or 'high'",
		),
		{ effort: "max" },
		stale,
	);
	assert.equal(recovery?.rejected, "max");
	assert.equal(recovery?.effective, "high");
});

test("without a list, the rejected level is dropped", () => {
	const recovery = recoverReasoning(
		rejection("reasoning_effort none is not supported for this model"),
		{ effort: "none" },
		stale,
	);
	assert.equal(recovery?.effective, "low");
	assert.deepEqual(recovery?.spec.levels, [
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
});

test("provider labels map back through upstreamEffortMap", () => {
	const recovery = recoverReasoning(
		rejection("thinking_level 'MINIMAL' is invalid; use one of 'LOW', 'HIGH'"),
		{ effort: "minimal" },
		meta({
			kind: "gemini_level",
			levels: ["minimal", "low", "high"],
			upstreamEffortMap: { minimal: "MINIMAL", low: "LOW", high: "HIGH" },
		}),
	);
	assert.equal(recovery?.effective, "low");
	assert.deepEqual(recovery?.spec.levels, ["low", "high"]);
});

test("unrelated or non-400 errors are left alone", () => {
	for (const error of [
		rejection("Invalid value for 'temperature': 'none'"),
		rejection("Unsupported value: 'high' for reasoning.summary"),
		rejection(OPENAI_NONE, 429),
		new Error(OPENAI_NONE),
	]) {
		assert.equal(recoverReasoning(error, { effort: "none" }, stale), undefined);
	}
	assert.equal(
		recoverReasoning(
			rejection(OPENAI_NONE),
			{ effort: "none" },
			{ ...stale, capabilities: { ...stale.capabilities, reasoning: false } },
		),
		undefined,
	);
});

test("executeChat retries a rejected effort once at the nearest supported level", async () => {
	const efforts: unknown[] = [];
	const ctx: AdapterContext = {
		upstreamModel: "gpt-x",
		credentials: { apiKey: "sk-test" },
		meta: stale,
		transport: "chat_completions",
		requestId: "t",
	};
	const req: CanonicalChatRequest = {
		callType: "chat",
		model: "gpt",
		messages: [{ role: "user", content: "hello" }],
		stream: false,
		reasoning: { effort: "none" },
	};
	const result = await withStubbedFetch(
		(_url, init) => {
			const body = JSON.parse(String(init?.body)) as {
				reasoning_effort?: string;
			};
			efforts.push(body.reasoning_effort);
			return body.reasoning_effort === "none"
				? jsonResponse(
						{
							error: {
								message: OPENAI_NONE,
								type: "invalid_request_error",
								param: "reasoning_effort",
								code: "unsupported_value",
							},
						},
						400,
					)
				: jsonResponse({
						id: "c",
						object: "chat.completion",
						created: 0,
						model: "gpt-x",
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: "OK" },
								finish_reason: "stop",
							},
						],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					});
		},
		() => executeChat(openaiAdapter, req, ctx),
	);
	assert.deepEqual(efforts, ["none", "low"]);
	assert.equal(result.kind, "json");
	assert.deepEqual(ctx.diagnostics?.metadata?.reasoningRecovery, {
		rejected: "none",
		effective: "low",
		levels: ["low", "medium", "high", "xhigh", "max"],
	});
	// The deployment's own metadata is never mutated.
	assert.deepEqual(stale.reasoning?.levels[0], "none");
});
