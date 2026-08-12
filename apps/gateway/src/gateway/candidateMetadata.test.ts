import type { DeploymentCandidate } from "./deploymentCandidates.ts";
import { candidateMetadata } from "./candidateMetadata.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function candidate(row: Record<string, unknown>): DeploymentCandidate {
	return {
		upstreamModel: "gemini-3.5-flash",
		row: { adapterKey: "googleaistudio", catalogEntry: null, ...row },
	} as unknown as DeploymentCandidate;
}

test("candidateMetadata: snapshots the deployment label when set", () => {
	const meta = candidateMetadata(candidate({ label: "Gemini - billing key" }));
	assert.equal(meta.deploymentLabel, "Gemini - billing key");
	assert.equal(meta.adapterKey, "googleaistudio");
	assert.equal(meta.upstreamModel, "gemini-3.5-flash");
	assert.equal(meta.custom, false);
});

test("candidateMetadata: omits deploymentLabel when the deployment has no label", () => {
	const meta = candidateMetadata(candidate({ label: null }));
	assert.equal("deploymentLabel" in meta, false);
});
