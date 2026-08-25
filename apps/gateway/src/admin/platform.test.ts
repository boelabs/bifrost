import type { ContentfulStatusCode } from "hono/utils/http-status";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";

import "#adapters/index.ts";

import { createDeploymentSchema, platformAdminApp } from "./platform.ts";

/** Mounts the admin app behind the OpenAI-compatible error handler, without pulling auth/env. */
function adminAppWithErrors(): Hono {
	const app = new Hono();
	app.onError((err, c) =>
		GatewayError.is(err)
			? c.json(err.toOpenAI(), err.httpStatus as ContentfulStatusCode)
			: c.json({ error: { message: "server" } }, 500),
	);
	app.route("/", platformAdminApp);
	return app;
}

test("admin operations exposes embeddings by operation, endpoint, and transport per adapter", async () => {
	const response = await platformAdminApp.request("/operations");
	assert.equal(response.status, 200);

	const body = (await response.json()) as {
		data: {
			operations: Array<{
				id: string;
				callType?: string;
				publicEndpoints: string[];
			}>;
			adapters: Array<{
				id: string;
				credentials: { required: string[] };
				supportedCallTypes: string[];
				operations: Array<{
					id: string;
					family: string;
					callType: string;
					publicEndpoints: string[];
					transports: string[];
					defaultTransport: string | null;
					contentInputs: Record<
						string,
						Record<
							"file" | "image",
							{ sources: string[]; maxBytes?: number; mimeTypes?: string[] }
						>
					>;
				}>;
			}>;
		};
	};

	const embeddingOperation = body.data.operations.find(
		(operation) => operation.id === "embedding.create",
	);
	assert.equal(embeddingOperation?.callType, "embeddings");
	assert.deepEqual(embeddingOperation?.publicEndpoints, ["/v1/embeddings"]);
	const rerankOperation = body.data.operations.find(
		(operation) => operation.id === "rerank",
	);
	assert.equal(rerankOperation?.callType, "rerank");
	assert.deepEqual(rerankOperation?.publicEndpoints, ["/v1/rerank"]);
	for (const [adapterId, transport] of [
		["openrouter", "openrouter_rerank"],
		["vercel", "cohere_rerank"],
	] as const) {
		const adapter = body.data.adapters.find((item) => item.id === adapterId);
		if (!adapter) throw new Error(`adapter ${adapterId} is not registered`);
		assert.ok(adapter.supportedCallTypes.includes("rerank"));
		const operation = adapter.operations.find((item) => item.id === "rerank");
		assert.equal(operation?.family, "reranking");
		assert.equal(operation?.defaultTransport, transport);
		assert.deepEqual(operation?.transports, [transport]);
	}

	const expectedAdapters = [
		["openai", "embeddings"],
		["azureopenai", "embeddings"],
		["googleaistudio", "embed_content"],
		["openaicompatible", "embeddings"],
		["vercel", "embeddings"],
	] as const;
	for (const [adapterId, expectedDefault] of expectedAdapters) {
		const adapter = body.data.adapters.find((item) => item.id === adapterId);
		assert.ok(adapter, `adapter ${adapterId} is not registered`);
		assert.ok(adapter.credentials.required.includes("apiKey"));
		assert.ok(adapter.supportedCallTypes.includes("embeddings"));

		const operation = adapter.operations.find(
			(item) => item.id === "embedding.create",
		);
		assert.equal(operation?.family, "embedding");
		assert.equal(operation?.callType, "embeddings");
		assert.deepEqual(operation?.publicEndpoints, ["/v1/embeddings"]);
		assert.equal(operation?.defaultTransport, expectedDefault);
		assert.ok(operation?.transports.includes(expectedDefault));
	}

	const google = body.data.adapters.find(
		(adapter) => adapter.id === "googleaistudio",
	);
	const googleText = google?.operations.find(
		(operation) => operation.id === "text.generate",
	);
	assert.deepEqual(googleText?.contentInputs.generate_content, {
		file: { sources: ["data_url"], maxBytes: 20_000_000 },
		image: {
			sources: ["data_url"],
			mimeTypes: [
				"image/png",
				"image/jpeg",
				"image/webp",
				"image/heic",
				"image/heif",
			],
			maxBytes: 20_000_000,
		},
	});
});

test("admin platform: rejects legacy provider field", async () => {
	const app = adminAppWithErrors();
	const parsed = createDeploymentSchema.safeParse({
		publicModel: "x",
		adapterKey: "openai",
		provider: "openai",
		upstreamModel: "gpt-image-2",
		credentials: { apiKey: "k" },
	});
	assert.equal(parsed.success, false);
	if (!parsed.success)
		assert.match(
			parsed.error.issues.map((issue) => issue.message).join("; "),
			/provider/,
		);

	const response = await app.request("/deployments/resolve", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			publicModel: "x",
			adapterKey: "openai",
			provider: "openai",
			upstreamModel: "gpt-image-2",
		}),
	});
	assert.equal(response.status, 400);
});

test("admin platform: catalog validation errors identify the adapter and model", async () => {
	const app = adminAppWithErrors();
	const response = await app.request("/deployments/resolve", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			publicModel: "transcribe",
			adapterKey: "azureopenai",
			upstreamModel: "missing-transcribe-model",
		}),
	});

	assert.equal(response.status, 400);
	const json = (await response.json()) as {
		error?: { message?: string; param?: string };
	};
	assert.equal(
		json.error?.message,
		'"missing-transcribe-model" is not in the "azureopenai" catalog; provide catalogEntry for this custom model',
	);
	assert.equal(json.error?.param, "catalogEntry");
});

test("admin platform: resolves Azure gpt-transcribe from the catalog", async () => {
	const response = await platformAdminApp.request("/deployments/resolve", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			publicModel: "transcribe",
			adapterKey: "azureopenai",
			upstreamModel: "gpt-transcribe",
		}),
	});

	assert.equal(response.status, 200);
	const json = (await response.json()) as {
		data?: { source?: string; operations?: Array<{ id?: string }> };
	};
	assert.equal(json.data?.source, "catalog");
	assert.ok(
		json.data?.operations?.some(
			(operation) => operation.id === "audio.transcribe",
		),
	);
});

test("admin platform: validates adapter credential requirements before DB writes", async () => {
	const app = adminAppWithErrors();

	const missingApiKey = await app.request("/deployments", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			publicModel: "x",
			adapterKey: "openai",
			upstreamModel: "gpt-image-2",
			credentials: {},
		}),
	});
	assert.equal(missingApiKey.status, 400);
	const apiKeyJson = (await missingApiKey.json()) as {
		error?: { param?: string };
	};
	assert.equal(apiKeyJson.error?.param, "credentials.apiKey");

	const missingBaseUrl = await app.request("/deployments", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			publicModel: "x",
			adapterKey: "openaicompatible",
			upstreamModel: "custom",
			credentials: { apiKey: "k" },
			catalogEntry: {
				operations: {
					"text.generate": {
						capabilities: {
							tools: false,
							vision: false,
							reasoning: false,
							structuredOutputs: false,
						},
						maxInputTokens: 1024,
						maxOutputTokens: 256,
					},
				},
			},
		}),
	});
	assert.equal(missingBaseUrl.status, 400);
	const baseUrlJson = (await missingBaseUrl.json()) as {
		error?: { param?: string };
	};
	assert.equal(baseUrlJson.error?.param, "credentials.baseUrl");
});

test("admin platform: rejects deployment metadata over the size limit", async () => {
	const app = adminAppWithErrors();
	// Oversized metadata trips the size guard at validation, before any DB access.
	const body = JSON.stringify({
		publicModel: "x",
		adapterKey: "openai",
		upstreamModel: "gpt-image-2",
		credentials: { apiKey: "k" },
		metadata: { note: "x".repeat(17_000) },
	});
	const response = await app.request("/deployments", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
	assert.equal(response.status, 400);
	const json = (await response.json()) as { error?: { param?: string } };
	assert.match(json.error?.param ?? "", /metadata/);
});
