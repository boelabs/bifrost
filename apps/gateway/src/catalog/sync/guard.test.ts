import { catalogDirectory, guardCatalog, guardChangedFiles } from "./guard.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const catalog = (models: Record<string, unknown>) => ({ models });

describe("guardChangedFiles", () => {
	test("allows catalog files only", () => {
		assert.deepEqual(
			guardChangedFiles([
				"apps/gateway/src/adapters/openai/catalog.json",
				"apps/gateway/src/adapters/vercel/catalog.json",
			]),
			[],
		);
		const findings = guardChangedFiles([
			"apps/gateway/src/adapters/openai/index.ts",
			"AGENTS.md",
		]);
		assert.deepEqual(
			findings.map((f) => f.level),
			["block", "block"],
		);
	});

	test("reads the adapter directory from a catalog path", () => {
		assert.equal(
			catalogDirectory("apps/gateway/src/adapters/zai/catalog.json"),
			"zai",
		);
		assert.equal(
			catalogDirectory("apps/gateway/src/adapters/zai/index.ts"),
			undefined,
		);
	});
});

describe("guardCatalog", () => {
	test("accepts additions, deprecations and small price moves", () => {
		const before = catalog({
			a: { pricing: { inputCentsPerMTokens: 100, outputCentsPerMTokens: 400 } },
		});
		const after = catalog({
			a: {
				deprecated: true,
				pricing: { inputCentsPerMTokens: 120, outputCentsPerMTokens: 400 },
			},
			b: { pricing: { inputCentsPerMTokens: 10 } },
		});
		assert.deepEqual(guardCatalog("openai", before, after), []);
	});

	test("blocks removing a model from a hand-maintained catalog", () => {
		const findings = guardCatalog("openai", catalog({ a: {} }), catalog({}));
		assert.deepEqual(findings, [
			{
				level: "block",
				message: "openai/a was removed; mark it deprecated instead",
			},
		]);
	});

	test("lets generated snapshots drop models", () => {
		assert.deepEqual(
			guardCatalog("vercel", catalog({ a: {} }), catalog({})),
			[],
		);
	});

	test("blocks reversing a deprecation", () => {
		const findings = guardCatalog(
			"minimax",
			catalog({ a: { deprecated: true } }),
			catalog({ a: {} }),
		);
		assert.deepEqual(
			findings.map((f) => f.level),
			["block"],
		);
	});

	test("sends large or removed price changes to a human, tiers included", () => {
		const before = catalog({
			a: {
				pricing: {
					inputCentsPerMTokens: 1000,
					cacheReadCentsPerMTokens: 100,
					tiers: [{ aboveInputTokens: 272_000, inputCentsPerMTokens: 400 }],
				},
			},
		});
		const after = catalog({
			a: {
				pricing: {
					inputCentsPerMTokens: 500,
					tiers: [{ aboveInputTokens: 272_000, inputCentsPerMTokens: 900 }],
				},
			},
		});
		assert.deepEqual(guardCatalog("anthropic", before, after), [
			{
				level: "review",
				message: "anthropic/a: pricing.inputCentsPerMTokens 1000 -> 500",
			},
			{
				level: "review",
				message:
					"anthropic/a: pricing.cacheReadCentsPerMTokens removed (was 100)",
			},
			{
				level: "review",
				message:
					"anthropic/a: pricing.tiers[>272000].inputCentsPerMTokens 400 -> 900",
			},
		]);
	});

	test("treats a price moving to or from zero as large", () => {
		const findings = guardCatalog(
			"zai",
			catalog({ a: { pricing: { outputCentsPerMTokens: 0 } } }),
			catalog({ a: { pricing: { outputCentsPerMTokens: 40 } } }),
		);
		assert.deepEqual(
			findings.map((f) => f.level),
			["review"],
		);
	});
});
