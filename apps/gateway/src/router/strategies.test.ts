import type { DeploymentCandidate } from "#gateway/deploymentCandidates.ts";
import type { DeploymentMetrics } from "./state.ts";
import { pickDeployment } from "./strategies.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function cand(id: string, weight = 1): DeploymentCandidate {
	return {
		row: { id, weight } as DeploymentCandidate["row"],
		adapter: {
			key: "fake",
			credentials: { required: [] },
			supportedCallTypes: new Set(["chat"]),
		} as DeploymentCandidate["adapter"],
		upstreamModel: id,
		meta: {
			capabilities: {
				tools: true,
				vision: true,
				reasoning: false,
				structuredOutputs: false,
			},
		},
	};
}

function metrics(
	m: Record<string, Partial<DeploymentMetrics>>,
): Map<string, DeploymentMetrics> {
	const map = new Map<string, DeploymentMetrics>();
	for (const [id, v] of Object.entries(m)) {
		map.set(id, {
			inflight: v.inflight ?? 0,
			rpm: v.rpm ?? 0,
			tpm: v.tpm ?? 0,
			successes: v.successes ?? 0,
			failures: v.failures ?? 0,
			latencyMs: v.latencyMs ?? null,
			throughputTps: v.throughputTps ?? null,
			healthScore: v.healthScore ?? 1,
		});
	}
	return map;
}

test("a single candidate is returned as-is", () => {
	const only = cand("a");
	assert.equal(pickDeployment("least-busy", [only], new Map()), only);
});

test("least-busy chooses the lowest inflight", () => {
	const c = [cand("a"), cand("b"), cand("c")];
	const m = metrics({
		a: { inflight: 5 },
		b: { inflight: 1 },
		c: { inflight: 3 },
	});
	assert.equal(pickDeployment("least-busy", c, m).row.id, "b");
});

test("usage-based-tpm chooses the lowest tpm", () => {
	const c = [cand("a"), cand("b")];
	const m = metrics({ a: { tpm: 1000 }, b: { tpm: 10 } });
	assert.equal(pickDeployment("usage-based-tpm", c, m).row.id, "b");
});

test("usage-based-rpm chooses the lowest rpm", () => {
	const c = [cand("a"), cand("b")];
	const m = metrics({ a: { rpm: 2 }, b: { rpm: 9 } });
	assert.equal(pickDeployment("usage-based-rpm", c, m).row.id, "a");
});

test("latency-based chooses the lowest observed latency", () => {
	const c = [cand("a"), cand("b")];
	const m = metrics({ a: { latencyMs: 900 }, b: { latencyMs: 120 } });
	assert.equal(pickDeployment("latency-based", c, m).row.id, "b");
});

test("throughput-based chooses the highest observed throughput", () => {
	const c = [cand("a"), cand("b")];
	const m = metrics({ a: { throughputTps: 12 }, b: { throughputTps: 28 } });
	assert.equal(pickDeployment("throughput-based", c, m).row.id, "b");
});

test("price-based chooses the lowest catalog price", () => {
	const c = [cand("a"), cand("b")];
	c[0]!.meta.pricing = {
		inputCentsPerMTokens: 300,
		outputCentsPerMTokens: 1200,
	};
	c[1]!.meta.pricing = {
		inputCentsPerMTokens: 100,
		outputCentsPerMTokens: 400,
	};
	assert.equal(pickDeployment("price-based", c, new Map()).row.id, "b");
});

test("price-based compares search-unit rates when every candidate uses that basis", () => {
	const c = [cand("a"), cand("b")];
	c[0]!.meta.pricing = { searchUnitCents: 0.25 };
	c[1]!.meta.pricing = { searchUnitCents: 0.1 };
	assert.equal(pickDeployment("price-based", c, new Map()).row.id, "b");
});

test("price-based never falsely compares token pricing with search-unit pricing", () => {
	const c = [cand("tokens"), cand("search")];
	c[0]!.meta.pricing = { inputCentsPerMTokens: 1 };
	c[1]!.meta.pricing = { searchUnitCents: 10_000 };
	const seen = new Set<string>();
	for (let i = 0; i < 100; i++)
		seen.add(pickDeployment("price-based", c, new Map()).row.id);
	assert.deepEqual(seen, new Set(["tokens", "search"]));
});

test("health-aware chooses the strongest health score adjusted by weight", () => {
	const c = [cand("a", 1), cand("b", 2)];
	const m = metrics({ a: { healthScore: 0.9 }, b: { healthScore: 0.8 } });
	assert.equal(pickDeployment("health-aware", c, m).row.id, "b");
});

test("simple-shuffle always returns a valid candidate", () => {
	const c = [cand("a", 1), cand("b", 3), cand("c", 0)];
	const ids = new Set(c.map((x) => x.row.id));
	for (let i = 0; i < 50; i++) {
		assert.ok(ids.has(pickDeployment("simple-shuffle", c, new Map()).row.id));
	}
});
