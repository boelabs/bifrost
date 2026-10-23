import { createDeployment, deleteDeployment } from "#db/repos/deployments.ts";
import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { makeOpenAIContractTestApp } from "#test-support/app.ts";
import { responsesHandler } from "#endpoints/responses.ts";
import { withStubbedFetch } from "#test-support/fetch.ts";
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
	instance.post("/v1/responses", responsesHandler);
});

type Item = Record<string, unknown>;

/** A Gemini 3 stream that signs its text answer on a trailing empty part. */
function geminiStream(text: string, signature: string): Response {
	const chunks = [
		{ parts: [{ text: "Thinking it over.", thought: true }] },
		{ parts: [{ text }] },
		{
			parts: [{ text: "", thoughtSignature: signature }],
			finishReason: "STOP",
		},
	];
	return new Response(
		chunks
			.map(
				({ parts, finishReason }) =>
					`data: ${JSON.stringify({
						candidates: [
							{
								index: 0,
								content: { role: "model", parts },
								...(finishReason ? { finishReason } : {}),
							},
						],
						usageMetadata: {
							promptTokenCount: 4,
							candidatesTokenCount: 2,
							thoughtsTokenCount: 3,
							totalTokenCount: 9,
						},
					})}\n\n`,
			)
			.join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}

async function send(body: Item): Promise<Item[]> {
	const response = await app.request("/v1/responses", {
		method: "POST",
		headers: {
			authorization: `Bearer ${env.MASTER_KEY}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const wire = await response.text();
	assert.equal(response.status, 200, wire);
	const completed = wire
		.split("\n")
		.filter((line) => line.startsWith("data: {"))
		.map((line) => JSON.parse(line.slice(6)) as Item)
		.find((event) => event.type === "response.completed");
	assert.ok(completed, wire);
	return (completed.response as Item).output as Item[];
}

/** Output items as the Vercel AI SDK replays them with `store: false`. */
function replay(output: Item[]): Item[] {
	return output.flatMap((item): Item[] => {
		if (item.type === "message") {
			return [{ role: "assistant", id: item.id, content: item.content }];
		}
		return item.type === "reasoning" &&
			typeof item.encrypted_content === "string"
			? [
					{
						type: "reasoning",
						id: item.id,
						encrypted_content: item.encrypted_content,
						summary: [],
					},
				]
			: [];
	});
}

test("Gemini text signatures round-trip through a standard Responses client", {
	skip,
}, async () => {
	const row = await createDeployment({
		publicModel: `message-state-${randomUUID()}`,
		adapterKey: "googleaistudio",
		upstreamModel: "gemini-3.1-pro-preview",
		credentials: { apiKey: "test-key" },
	});
	const upstreamBodies: Item[] = [];
	let turn = 0;
	try {
		await withStubbedFetch(
			(_url, init) => {
				upstreamBodies.push(JSON.parse(String(init?.body)) as Item);
				turn += 1;
				return geminiStream(`Answer ${turn}.`, `sig-${turn}`);
			},
			async () => {
				const request = {
					model: row.publicModel,
					stream: true,
					store: false,
					include: ["reasoning.encrypted_content"],
					reasoning: { effort: "high" },
				};
				const first = await send({ ...request, input: "one" });
				assert.deepEqual(
					first.map((item) => item.type),
					["reasoning", "message", "reasoning"],
				);
				assert.ok(String(first[2]?.encrypted_content).startsWith("bfrs_1."));

				await send({
					...request,
					input: [
						{ role: "user", content: [{ type: "input_text", text: "one" }] },
						...replay(first),
						{ role: "user", content: [{ type: "input_text", text: "two" }] },
					],
				});
			},
		);
		const contents = upstreamBodies[1]?.contents as Item[];
		assert.deepEqual(contents[1], {
			role: "model",
			parts: [
				{ text: "Thinking it over.", thought: true },
				{ text: "Answer 1." },
				{ text: "", thoughtSignature: "sig-1" },
			],
		});
	} finally {
		await deleteDeployment(row.id);
	}
});
