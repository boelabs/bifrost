import { jsonResponse, withStubbedFetch } from "#test-support/fetch.ts";
import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { makeOpenAIContractTestApp } from "#test-support/app.ts";
import { chatResponseSchema } from "#contracts/openai/chat.ts";
import { chatCompletionsHandler } from "#endpoints/chat.ts";
import { responsesHandler } from "#endpoints/responses.ts";
import { messagesHandler } from "#endpoints/messages.ts";
import { eventually } from "#test-support/wait.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { env } from "#config/env.ts";
import { test } from "node:test";

import {
	createDeployment,
	deleteDeployment,
	updateDeployment,
} from "#db/repos/deployments.ts";

import {
	listOperationsPage,
	getOperationDetail,
} from "#db/repos/operations.ts";

import "#adapters/index.ts";

const skip =
	(await pgAvailable()) && (await redisAvailable())
		? false
		: "Postgres/Redis unavailable";
const app = makeOpenAIContractTestApp((app) => {
	app.post("/v1/chat/completions", chatCompletionsHandler);
	app.post("/v1/responses", responsesHandler);
	app.post("/v1/messages", messagesHandler);
});
const upstreamUsage = {
	input_tokens: 20,
	output_tokens: 8,
	total_tokens: 28,
	input_tokens_details: { cached_tokens: 12 },
	output_tokens_details: { reasoning_tokens: 5 },
};
const reasoningItem = {
	type: "reasoning",
	id: "rs_1",
	summary: [{ type: "summary_text", text: "A short summary." }],
	encrypted_content: "opaque-state",
};
const messageItem = {
	type: "message",
	id: "msg_1",
	role: "assistant",
	content: [{ type: "output_text", text: "Answer.", annotations: [] }],
};
const completed = {
	id: "resp_upstream",
	created_at: 1,
	model: "gpt-5.6-luna",
	status: "completed",
	output: [reasoningItem, messageItem],
	usage: upstreamUsage,
};

function requests(model: string) {
	return [
		[
			"/v1/chat/completions",
			{
				model,
				messages: [{ role: "user", content: "hello" }],
				reasoning_effort: "xhigh",
				store: false,
			},
		],
		[
			"/v1/responses",
			{
				model,
				input: "hello",
				include: ["reasoning.encrypted_content"],
				reasoning: { effort: "xhigh", summary: "auto" },
				store: false,
			},
		],
		[
			"/v1/messages",
			{
				model,
				messages: [{ role: "user", content: "hello" }],
				max_tokens: 100,
				output_config: { effort: "xhigh" },
				thinking: { type: "adaptive" },
			},
		],
	] as const;
}

function send(
	path: string,
	body: Record<string, unknown>,
	requestId = randomUUID(),
) {
	return app.request(path, {
		method: "POST",
		headers: {
			authorization: `Bearer ${env.MASTER_KEY}`,
			"content-type": "application/json",
			"x-request-id": requestId,
		},
		body: JSON.stringify(body),
	});
}

async function deployment(adapterKey = "azureopenai") {
	return createDeployment({
		publicModel: `transport-contract-${randomUUID()}`,
		adapterKey,
		upstreamModel: "gpt-5.6-luna",
		credentials: {
			apiKey: "test-key",
			baseUrl: "https://resource.openai.azure.com/openai/v1",
		},
	});
}

async function operation(requestId: string) {
	return eventually(
		async () => {
			const row = (await listOperationsPage({ limit: 1, offset: 0, requestId }))
				.rows[0];
			const detail = row ? await getOperationDetail(row.id) : null;
			return detail?.lifecycleState === "finished" ? detail : null;
		},
		{ description: `operation ${requestId}` },
	);
}

test("Azure and OpenAI use Responses for every public text contract without extra attempts", {
	skip,
}, async () => {
	for (const provider of ["azureopenai", "openai"]) {
		const row = await deployment(provider);
		try {
			let calls = 0;
			await withStubbedFetch(
				(input, init) => {
					calls++;
					assert.equal(new URL(String(input)).pathname, "/openai/v1/responses");
					const body = JSON.parse(String(init?.body));
					assert.equal(body.reasoning.effort, "xhigh");
					assert.equal(body.store, false);
					return jsonResponse(completed);
				},
				async () => {
					for (const [path, body] of requests(row.publicModel)) {
						const id = randomUUID();
						const response = await send(path, body, id);
						assert.equal(response.status, 200, await response.clone().text());
						const data = (await response.json()) as { model: string };
						assert.equal(data.model, row.publicModel);
						assert.ok(JSON.stringify(data).includes("A short summary."));
						const detail = await operation(id);
						assert.equal(detail.attempts.length, 1);
						assert.equal(detail.attempts[0]?.transport, "responses");
						assert.equal(detail.reasoningTokens, 5);
						assert.equal(detail.cacheReadTokens, 12);
					}
				},
			);
			assert.equal(calls, 3);
		} finally {
			await deleteDeployment(row.id);
		}
	}
});

test("Responses streaming preserves reasoning, encrypted state and detailed usage in Chat and logs", {
	skip,
}, async () => {
	const row = await deployment();
	try {
		const events = [
			{
				type: "response.created",
				response: { ...completed, status: "in_progress", output: [] },
			},
			{
				type: "response.output_item.added",
				output_index: 0,
				item: { type: "reasoning", id: "rs_1", summary: [] },
			},
			{
				type: "response.reasoning_summary_text.delta",
				item_id: "rs_1",
				output_index: 0,
				summary_index: 0,
				delta: "A short summary.",
			},
			{
				type: "response.output_item.done",
				output_index: 0,
				item: reasoningItem,
			},
			{
				type: "response.output_item.added",
				output_index: 1,
				item: { ...messageItem, content: [] },
			},
			{
				type: "response.output_text.delta",
				item_id: "msg_1",
				output_index: 1,
				content_index: 0,
				delta: "Answer.",
			},
			{ type: "response.output_item.done", output_index: 1, item: messageItem },
			{ type: "response.completed", response: completed },
		];
		await withStubbedFetch(
			() =>
				new Response(
					events
						.map(
							(event) =>
								`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
						)
						.join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
			async () => {
				for (const [path, body] of requests(row.publicModel).slice(0, 2)) {
					const id = randomUUID();
					const response = await send(
						path,
						{ ...body, stream: true, stream_options: { include_usage: true } },
						id,
					);
					const wire = await response.text();
					assert.equal(response.status, 200, wire);
					assert.ok(wire.includes("A short summary."));
					assert.ok(wire.includes("opaque-state"));
					assert.ok(wire.includes('"reasoning_tokens":5'));
					assert.ok(wire.includes('"cached_tokens":12'));
					const detail = await operation(id);
					assert.equal(detail.outcome, "success");
					assert.equal(detail.attempts.length, 1);
					assert.equal(detail.reasoningTokens, 5);
					assert.equal(detail.cacheReadTokens, 12);
					assert.equal(detail.attempts[0]?.reasoningTokens, 5);
				}
			},
		);
	} finally {
		await deleteDeployment(row.id);
	}
});

test("Chat tool results replay their reasoning state through the default Responses transport", {
	skip,
}, async () => {
	const row = await deployment();
	try {
		let calls = 0;
		const tool = {
			type: "function_call",
			id: "fc_1",
			call_id: "call_1",
			name: "lookup",
			arguments: '{"key":"value"}',
		};
		await withStubbedFetch(
			(input, init) => {
				calls++;
				assert.equal(new URL(String(input)).pathname, "/openai/v1/responses");
				const body = JSON.parse(String(init?.body));
				if (calls === 1) {
					assert.deepEqual(body.tools, [
						{
							type: "function",
							name: "lookup",
							parameters: {
								type: "object",
								properties: { key: { type: "string" } },
							},
						},
					]);
					return jsonResponse({ ...completed, output: [reasoningItem, tool] });
				}
				assert.deepEqual(body.input.slice(-3), [
					reasoningItem,
					{
						type: "function_call",
						call_id: "call_1",
						name: "lookup",
						arguments: '{"key":"value"}',
					},
					{ type: "function_call_output", call_id: "call_1", output: "Found." },
				]);
				return jsonResponse(completed);
			},
			async () => {
				const initial = requests(row.publicModel)[0][1];
				const tools = [
					{
						type: "function",
						function: {
							name: "lookup",
							parameters: {
								type: "object",
								properties: { key: { type: "string" } },
							},
						},
					},
				];
				const first = await send("/v1/chat/completions", { ...initial, tools });
				assert.equal(first.status, 200);
				const data = chatResponseSchema.parse(await first.json());
				assert.equal(data.choices[0]!.finish_reason, "tool_calls");
				assert.equal(data.choices[0]!.message.reasoning, "A short summary.");
				const second = await send("/v1/chat/completions", {
					...initial,
					tools,
					messages: [
						...initial.messages,
						data.choices[0]!.message,
						{ role: "tool", tool_call_id: "call_1", content: "Found." },
					],
				});
				assert.equal(second.status, 200, await second.text());
			},
		);
		assert.equal(calls, 2);
	} finally {
		await deleteDeployment(row.id);
	}
});

test("DeepSeek keeps its default for public Responses and requires an override for schema output", {
	skip,
}, async () => {
	const row = await createDeployment({
		publicModel: `transport-contract-${randomUUID()}`,
		adapterKey: "deepseek",
		upstreamModel: "deepseek-v4-flash",
		credentials: { apiKey: "test-key" },
	});
	try {
		const schema = {
			type: "json_schema",
			name: "answer",
			schema: {
				type: "object",
				properties: { answer: { type: "string" } },
				required: ["answer"],
				additionalProperties: false,
			},
			strict: true,
		};
		await withStubbedFetch(
			(input) => {
				assert.equal(new URL(String(input)).pathname, "/v1/chat/completions");
				return jsonResponse({
					id: "chat_1",
					created: 1,
					model: row.upstreamModel,
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: "Answer." },
							finish_reason: "stop",
						},
					],
				});
			},
			async () => {
				const response = await send("/v1/responses", {
					model: row.publicModel,
					input: "hello",
					store: false,
				});
				assert.equal(response.status, 200, await response.text());
			},
		);
		await withStubbedFetch(
			() => {
				throw new Error("Schema request reached incompatible transport");
			},
			async () => {
				const response = await send("/v1/chat/completions", {
					model: row.publicModel,
					messages: [{ role: "user", content: "hello" }],
					response_format: {
						type: "json_schema",
						json_schema: {
							name: schema.name,
							schema: schema.schema,
							strict: true,
						},
					},
				});
				assert.equal(response.status, 400, await response.text());
			},
		);
		await updateDeployment(row.id, {
			transportOverrides: { "text.generate": "responses" },
		});
		await withStubbedFetch(
			(input, init) => {
				assert.equal(String(input), "https://api.deepseek.com/responses");
				assert.deepEqual(JSON.parse(String(init?.body)).text.format, {
					type: "json_schema",
					name: schema.name,
					schema: schema.schema,
				});
				return jsonResponse(completed);
			},
			async () => {
				const response = await send("/v1/responses", {
					model: row.publicModel,
					input: "hello",
					store: false,
					text: { format: schema },
				});
				assert.equal(response.status, 200, await response.text());
			},
		);
	} finally {
		await deleteDeployment(row.id);
	}
});

test("incompatible Chat parameters fail before contacting Azure; explicit override preserves them", {
	skip,
}, async () => {
	const row = await deployment();
	try {
		await withStubbedFetch(
			() => {
				throw new Error("Incompatible request reached upstream");
			},
			async () => {
				for (const fields of [
					{ n: 2 },
					{ seed: 42 },
					{ stop: ["END"] },
					{ logprobs: true },
				]) {
					const response = await send("/v1/chat/completions", {
						...requests(row.publicModel)[0][1],
						...fields,
					});
					assert.equal(response.status, 400, await response.clone().text());
				}
			},
		);
		await updateDeployment(row.id, {
			transportOverrides: { "text.generate": "chat_completions" },
		});
		await withStubbedFetch(
			(input, init) => {
				assert.equal(
					new URL(String(input)).pathname,
					"/openai/v1/chat/completions",
				);
				const body = JSON.parse(String(init?.body));
				assert.deepEqual(body.stop, ["END"]);
				assert.equal(body.seed, 42);
				return jsonResponse({
					id: "chat_1",
					created: 1,
					model: "gpt-5.6-luna",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: "Answer." },
							finish_reason: "stop",
						},
					],
					usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
				});
			},
			async () => {
				const response = await send("/v1/chat/completions", {
					...requests(row.publicModel)[0][1],
					stop: ["END"],
					seed: 42,
				});
				assert.equal(response.status, 200, await response.text());
			},
		);
	} finally {
		await deleteDeployment(row.id);
	}
});
