import type { ExtensionCanonicalRequest, ExtensionImageOutput } from "./sdk.ts";
import type { ExtensionInstanceSource, ExtensionScope } from "./runtime.ts";
import { mkdtemp, writeFile } from "node:fs/promises";
import { extensionRuntime } from "./runtime.ts";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

type Instances = Awaited<
	ReturnType<ExtensionInstanceSource["load"]>
>["instances"];

function scope(model = "demo-model"): ExtensionScope {
	return {
		requestId: "req-test",
		callType: "chat",
		endpoint: "/v1/chat/completions",
		publicModel: model,
		auth: { type: "master" },
		signal: new AbortController().signal,
	};
}

/**
 * Writes the module files to a temp dir and returns a source + base directory pair, mirroring what the
 * DB source produces (materialized module paths + instances), without a file manifest.
 */
async function moduleSource(
	files: Record<string, string>,
	instances: Instances,
): Promise<{ source: ExtensionInstanceSource; dir: string }> {
	const dir = await mkdtemp(join(tmpdir(), "bifrost-ext-"));
	for (const [name, content] of Object.entries(files)) {
		await writeFile(join(dir, name), content);
	}
	const source: ExtensionInstanceSource = {
		load: async () => ({
			modules: Object.keys(files).map((path) => ({ path: `./${path}` })),
			instances,
		}),
	};
	return { source, dir };
}

async function load(
	files: Record<string, string>,
	instances: Instances,
): Promise<void> {
	const { source, dir } = await moduleSource(files, instances);
	await extensionRuntime.loadFromSource(source, dir);
}

async function resetRuntime(): Promise<void> {
	await extensionRuntime.loadFromSource(
		{ load: async () => ({ modules: [], instances: [] }) },
		tmpdir(),
	);
}

test("extensions: definitions load and canonical request hooks apply", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	await load(
		{
			"preamble.mjs": `
				export default {
					key: "preamble",
					hooks: {
						onCanonicalRequest(ctx, req) {
							if (req.callType !== "chat") return req;
							if (!ctx.config.preamble) return req;
							return {
								...req,
								messages: [
									{ role: "system", content: ctx.config.preamble },
									...req.messages
								]
							};
						}
					}
				};
			`,
		},
		[
			{
				id: "preamble-default",
				definition: "preamble",
				match: { models: ["demo-model"] },
				config: { preamble: "You are Demo." },
			},
		],
	);

	const request = (await extensionRuntime.runCanonicalRequest(scope(), {
		callType: "chat",
		model: "demo-model",
		messages: [{ role: "user", content: "hi" }],
		stream: false,
	})) as ExtensionCanonicalRequest & {
		messages: Array<{ role: string; content: string }>;
	};

	assert.equal(request.messages[0]!.role, "system");
	assert.equal(request.messages[0]!.content, "You are Demo.");
});

test("extensions: canonical response hooks run before rendering", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	await load(
		{
			"response.mjs": `
				export default {
					key: "responsex",
					hooks: {
						onCanonicalResponse(ctx, response) {
							return {
								...response,
								choices: response.choices.map((choice) => ({
									...choice,
									message: {
										...choice.message,
										content: choice.message.content + " world"
									}
								}))
							};
						}
					}
				};
			`,
		},
		[{ id: "response-default", definition: "responsex" }],
	);

	const response = await extensionRuntime.runCanonicalResponse(scope(), {
		id: "chatcmpl_1",
		created: 1,
		model: "demo-model",
		choices: [
			{
				index: 0,
				finishReason: "stop",
				message: { role: "assistant", content: "hello" },
			},
		],
		usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
	});

	assert.equal(response.choices[0]!.message.content, "hello world");
});

test("extensions: stream event hooks transform chunks without buffering", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	await load(
		{
			"stream.mjs": `
				export default {
					key: "streamx",
					hooks: {
						onStreamEvent(ctx, event) {
							return {
								...event,
								choices: event.choices.map((choice) => ({
									...choice,
									delta: { ...choice.delta, content: "patched" }
								}))
							};
						}
					}
				};
			`,
		},
		[{ id: "stream-default", definition: "streamx" }],
	);

	const event = await extensionRuntime.runStreamEvent(scope(), {
		id: "chunk_1",
		created: 1,
		model: "demo-model",
		choices: [
			{
				index: 0,
				delta: { role: "assistant", content: "original" },
				finishReason: null,
			},
		],
	});

	assert.equal(event.choices[0]!.delta.content, "patched");
});

test("extensions: a duplicate definition is skipped, not fatal", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	const { source, dir } = await moduleSource(
		{
			"a.mjs": "export default { key: 'dupe', hooks: {} };",
			"b.mjs": "export default { key: 'dupe', hooks: {} };",
		},
		[],
	);

	await extensionRuntime.loadFromSource(source, dir);
	const status = extensionRuntime.status();
	assert.equal(status.definitions.length, 1);
	assert.equal(status.healthy, true);
});

test("extensions: a malformed instance spec is rejected", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	const source: ExtensionInstanceSource = {
		load: async () => ({
			modules: [],
			instances: [
				{ id: "bad id with spaces", definition: "x" },
			] as unknown as Instances,
		}),
	};

	await assert.rejects(
		extensionRuntime.loadFromSource(source, tmpdir()),
		/extensions manifest/,
	);
});

test("extensions: a module with an invalid export is skipped, not fatal", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	const { source, dir } = await moduleSource(
		{ "bad.mjs": "export default { key: 'bad' };" },
		[],
	);

	await extensionRuntime.loadFromSource(source, dir);
	assert.equal(extensionRuntime.status().definitions.length, 0);
});

test("extensions: a critical instance with invalid config is disabled and unhealthy, not fatal", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	const { source, dir } = await moduleSource(
		{
			"schema.mjs": `
				export default {
					key: "schema",
					configSchema: {
						safeParse(value) {
							if (value && value.enabled === true) {
								return { success: true, data: value };
							}
							return { success: false, error: new Error("enabled must be true") };
						}
					},
					hooks: {}
				};
			`,
		},
		[
			{
				id: "schema-default",
				definition: "schema",
				critical: true,
				config: { enabled: false },
			},
		],
	);

	// Must NOT throw: a misconfigured critical instance is disabled, not fatal.
	await extensionRuntime.loadFromSource(source, dir);
	const status = extensionRuntime.status();
	assert.equal(status.instances[0]!.status, "runtime_disabled");
	assert.equal(status.healthy, false);
	assert.equal(status.status, "error");
});

test("extensions: a critical instance with a missing definition is disabled, not fatal", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	// The production incident: a critical instance row whose definition has no artifact yet. This must
	// degrade (disabled + unhealthy), never crash the boot/reload.
	const source: ExtensionInstanceSource = {
		load: async () => ({
			modules: [],
			instances: [{ id: "orphan", definition: "missing", critical: true }],
		}),
	};

	await extensionRuntime.loadFromSource(source, tmpdir());
	const status = extensionRuntime.status();
	assert.equal(status.instances[0]!.id, "orphan");
	assert.equal(status.instances[0]!.status, "runtime_disabled");
	assert.equal(status.healthy, false);
	assert.equal(status.status, "error");
});

test("extensions: hook failures trip the circuit breaker", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	await load(
		{
			"broken.mjs": `
				export default {
					key: "broken",
					hooks: {
						onCanonicalRequest() {
							throw new Error("boom");
						}
					}
				};
			`,
		},
		[{ id: "broken-default", definition: "broken", critical: false }],
	);

	for (let i = 0; i < 3; i += 1) {
		await assert.rejects(
			extensionRuntime.runCanonicalRequest(scope(), {
				callType: "chat",
				model: "demo-model",
				messages: [],
				stream: false,
			}),
			/Extension "broken"/,
		);
	}

	const status = extensionRuntime.status();
	assert.equal(status.status, "degraded");
	assert.equal(status.healthy, true);
	assert.equal(status.instances[0]!.status, "runtime_disabled");
});

test("extensions: a hook that ignores cancellation is aborted, not awaited forever", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	await load(
		{
			"hang.mjs": `
				export default {
					key: "hang",
					hooks: {
						onCanonicalRequest() {
							// Never resolves and never checks ctx.signal.
							return new Promise(() => {});
						}
					}
				};
			`,
		},
		[{ id: "hang-default", definition: "hang", critical: false }],
	);

	const controller = new AbortController();
	const hangScope: ExtensionScope = { ...scope(), signal: controller.signal };
	const pending = extensionRuntime.runCanonicalRequest(hangScope, {
		callType: "chat",
		model: "demo-model",
		messages: [],
		stream: false,
	});
	setTimeout(() => controller.abort(new Error("client disconnected")), 10);

	await assert.rejects(pending, /client disconnected/);
	const status = extensionRuntime.status();
	assert.equal(status.instances[0]!.failureCount, 1);
});

test("extensions: onError hook failures never trip the circuit breaker", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	await load(
		{
			"obs.mjs": `
				export default {
					key: "obs",
					hooks: {
						onError() {
							throw new Error("logging backend down");
						}
					}
				};
			`,
		},
		// critical so that a wrongful breaker trip would mark the gateway unhealthy.
		[{ id: "obs-default", definition: "obs", critical: true }],
	);

	for (let i = 0; i < 5; i += 1) {
		// Must resolve, never throw, regardless of the hook blowing up.
		await extensionRuntime.runErrorHooks(scope(), new Error("upstream 500"));
	}

	const status = extensionRuntime.status();
	assert.equal(status.instances[0]!.failureCount, 0);
	assert.equal(status.instances[0]!.status, "active");
	assert.equal(status.healthy, true);
	assert.equal(status.status, "ok");
});

test("extensions: a breaker-disabled instance can be reset at runtime", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	await load(
		{
			"broken.mjs": `
				export default {
					key: "broken",
					hooks: {
						onCanonicalRequest() {
							throw new Error("boom");
						}
					}
				};
			`,
		},
		[{ id: "broken-default", definition: "broken", critical: false }],
	);

	const fire = () =>
		extensionRuntime.runCanonicalRequest(scope(), {
			callType: "chat",
			model: "demo-model",
			messages: [],
			stream: false,
		});

	for (let i = 0; i < 3; i += 1)
		await assert.rejects(fire(), /Extension "broken"/);
	assert.equal(
		extensionRuntime.status().instances[0]!.status,
		"runtime_disabled",
	);

	// Reset clears the trip and re-activates the instance.
	assert.deepEqual(extensionRuntime.resetInstance("broken-default"), {
		found: true,
		reset: true,
	});
	const afterReset = extensionRuntime.status();
	assert.equal(afterReset.instances[0]!.status, "active");
	assert.equal(afterReset.instances[0]!.failureCount, 0);
	assert.equal(afterReset.instances[0]!.lastError, null);

	// The breaker counts from zero again after a reset.
	await assert.rejects(fire(), /Extension "broken"/);
	assert.equal(extensionRuntime.status().instances[0]!.failureCount, 1);

	// Unknown ids and non-breaker disables are reported, not silently reset.
	assert.deepEqual(extensionRuntime.resetInstance("nope"), {
		found: false,
		reset: false,
	});
});

test("extensions: image output hooks can replace the encoded bytes", async (t) => {
	await resetRuntime();
	t.after(resetRuntime);
	await load(
		{
			"image.mjs": `
				export default {
					key: "imagehook",
					hooks: {
						onImageOutput(ctx, output) {
							return {
								...output,
								data: new Uint8Array([4, 5, 6])
							};
						}
					}
				};
			`,
		},
		[{ id: "image-default", definition: "imagehook", critical: false }],
	);

	const output: ExtensionImageOutput = {
		data: new Uint8Array([1, 2, 3]),
		mimeType: "image/png",
		format: "png",
		width: 1,
		height: 1,
	};

	const transformed = await extensionRuntime.runImageOutput(scope(), output);
	assert.deepEqual([...transformed.data], [4, 5, 6]);
});
