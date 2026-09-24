import { createDeployment, deleteDeployment } from "#db/repos/deployments.ts";
import { jsonResponse, withStubbedFetch } from "#test-support/fetch.ts";
import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { makeOpenAIContractTestApp } from "#test-support/app.ts";
import { imageGenerationsHandler } from "#endpoints/images.ts";
import { chatCompletionsHandler } from "#endpoints/chat.ts";
import { responsesHandler } from "#endpoints/responses.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { env } from "#config/env.ts";
import { test } from "node:test";

import "#adapters/index.ts";

const skip =
	(await pgAvailable()) && (await redisAvailable())
		? false
		: "Postgres/Redis unavailable";
const app = makeOpenAIContractTestApp((instance) => {
	instance.post("/v1/chat/completions", chatCompletionsHandler);
	instance.post("/v1/responses", responsesHandler);
	instance.post("/v1/images/generations", imageGenerationsHandler);
});

function send(path: string, body: Record<string, unknown>) {
	return app.request(path, {
		method: "POST",
		headers: {
			authorization: `Bearer ${env.MASTER_KEY}`,
			"content-type": "application/json",
			"x-unified-routing-metadata": "1",
		},
		body: JSON.stringify(body),
	});
}

function deployment(upstreamModel: string) {
	return createDeployment({
		publicModel: `resolved-${randomUUID()}`,
		adapterKey: "openai",
		upstreamModel,
		credentials: { apiKey: "test-key" },
	});
}

/** A valid 1x1 PNG: the gateway inspects returned image bytes. */
const PIXEL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC";

const completed = {
	id: "resp_upstream",
	created_at: 1,
	model: "gpt-6-astra",
	status: "completed",
	output: [
		{
			type: "message",
			id: "msg_1",
			role: "assistant",
			content: [{ type: "output_text", text: "OK", annotations: [] }],
		},
	],
	usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
};

test("text contracts report the effort the model ran at, not the one requested", {
	skip,
}, async () => {
	// GPT-6 Astra has no off switch: `none` snaps up to its floor, `low`.
	const row = await deployment("gpt-6-astra");
	try {
		const sent: unknown[] = [];
		await withStubbedFetch(
			(_input, init) => {
				const body = JSON.parse(String(init?.body)) as {
					reasoning?: { effort?: string };
				};
				sent.push(body.reasoning?.effort);
				return jsonResponse(completed);
			},
			async () => {
				const responses = await send("/v1/responses", {
					model: row.publicModel,
					input: "hello",
					reasoning: { effort: "none" },
					store: false,
				});
				assert.equal(responses.status, 200);
				const responsesBody = (await responses.json()) as {
					reasoning: { effort: string | null };
					unified_routing: { reasoning_effort: string | null };
				};
				assert.equal(responsesBody.reasoning.effort, "low");
				assert.equal(responsesBody.unified_routing.reasoning_effort, "low");

				const chat = await send("/v1/chat/completions", {
					model: row.publicModel,
					messages: [{ role: "user", content: "hello" }],
					reasoning_effort: "none",
				});
				assert.equal(chat.status, 200);
				const chatBody = (await chat.json()) as {
					unified_routing: { reasoning_effort: string | null };
				};
				assert.equal(chatBody.unified_routing.reasoning_effort, "low");
			},
		);
		assert.deepEqual(sent, ["low", "low"]);
	} finally {
		await deleteDeployment(row.id);
	}
});

test("images report the quality sent when the provider does not echo one", {
	skip,
}, async () => {
	// GPT Image 1 stops at `high`, so `max` is sent as `high`.
	const row = await deployment("gpt-image-1");
	try {
		const sent: unknown[] = [];
		await withStubbedFetch(
			(_input, init) => {
				sent.push(
					(JSON.parse(String(init?.body)) as { quality?: string }).quality,
				);
				return jsonResponse({
					created: 1,
					data: [{ b64_json: PIXEL_PNG }],
					usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
				});
			},
			async () => {
				const response = await send("/v1/images/generations", {
					model: row.publicModel,
					prompt: "draw",
					quality: "max",
				});
				const body = (await response.json()) as { quality?: string };
				assert.equal(response.status, 200, JSON.stringify(body));
				assert.equal(body.quality, "high");
			},
		);
		assert.deepEqual(sent, ["high"]);
	} finally {
		await deleteDeployment(row.id);
	}
});
