import { customCatalogEntrySchema } from "./schema.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function budgetEntry(budgets?: { max: number }) {
	return {
		operations: {
			"text.generate": {
				capabilities: {
					tools: true,
					vision: false,
					reasoning: true,
					structuredOutputs: true,
				},
				reasoning: {
					kind: "anthropic_budget",
					levels: ["max"],
					...(budgets ? { budgets } : {}),
				},
			},
		},
	};
}

test("budget reasoning requires an explicit token budget for max", () => {
	const missing = customCatalogEntrySchema.safeParse(budgetEntry());
	assert.equal(missing.success, false);
	if (!missing.success) {
		assert.ok(
			missing.error.issues.some(
				(issue) =>
					issue.path.join(".") ===
					"operations.text.generate.reasoning.budgets.max",
			),
		);
	}

	assert.equal(
		customCatalogEntrySchema.safeParse(budgetEntry({ max: 64_000 })).success,
		true,
	);
});

test("rerank profiles are strict, text-ready, and reserve image sources coherently", () => {
	const base = {
		operations: {
			rerank: {
				documentModalities: ["text"],
				maxDocuments: 1_000,
				maxQueryBytes: 1_024,
				maxDocumentBytes: 2_048,
				maxTotalDocumentBytes: 4_096,
				maxTokensPerDocument: 4_096,
				maxTotalTokens: 32_768,
				documentsPerSearchUnit: 100,
			},
		},
		pricing: { searchUnitCents: 0.1 },
	};
	assert.equal(customCatalogEntrySchema.safeParse(base).success, true);
	assert.equal(
		customCatalogEntrySchema.safeParse({
			...base,
			operations: {
				rerank: {
					...base.operations.rerank,
					imageSources: ["url"],
				},
			},
		}).success,
		false,
	);
	assert.equal(
		customCatalogEntrySchema.safeParse({
			...base,
			operations: {
				rerank: {
					...base.operations.rerank,
					documentModalities: ["text", "image"],
					imageSources: ["url", "data_url"],
				},
			},
		}).success,
		true,
	);
});

test("video profiles use portable quality and task vocabularies", () => {
	const entry = (quality: string, task = "text_to_video") => ({
		operations: {
			"video.generate": {
				durations: ["8"],
				qualities: [quality],
				tasks: [task],
				sizes: { "1280x720": {} },
			},
		},
	});
	for (const quality of ["auto", "low", "medium", "high", "native"]) {
		assert.equal(
			customCatalogEntrySchema.safeParse(entry(quality)).success,
			true,
		);
	}
	for (const quality of ["standard", "hd"]) {
		assert.equal(
			customCatalogEntrySchema.safeParse(entry(quality)).success,
			false,
		);
	}
	for (const task of [
		"text_to_video",
		"image_to_video",
		"reference_to_video",
		"edit",
		"extend",
	]) {
		assert.equal(
			customCatalogEntrySchema.safeParse(entry("auto", task)).success,
			true,
		);
	}
	assert.equal(
		customCatalogEntrySchema.safeParse(entry("auto", "remix")).success,
		false,
	);
});
