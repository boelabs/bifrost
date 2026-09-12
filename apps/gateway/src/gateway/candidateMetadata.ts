import type { DeploymentCandidate } from "./deploymentCandidates.ts";

/** Safe routing metadata: identifies the effective configuration without including credentials. */
export function candidateMetadata(
	candidate: DeploymentCandidate,
): Record<string, unknown> {
	return {
		upstreamModel: candidate.upstreamModel,
		adapterKey: candidate.row.adapterKey,
		custom: candidate.row.catalogEntry != null,
		// Snapshot the operator's label so operation logs identify *which* deployment (e.g. which API
		// key) served the request, even after it is later renamed or deleted.
		...(candidate.row.label != null
			? { deploymentLabel: candidate.row.label }
			: {}),
	};
}
