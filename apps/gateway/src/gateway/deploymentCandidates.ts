import { getAdapter } from "#adapters/registry.ts";
import type { Adapter } from "#adapters/types.ts";
import type { CallType } from "#core/callType.ts";
import { decryptRecord } from "#db/crypto.ts";

import {
	transcriptionProfileFor,
	embeddingProfileFor,
	rerankProfileFor,
	imageProfileFor,
	videoProfileFor,
} from "#catalog/types.ts";

import {
	listDeploymentsByPublicModel,
	type DeploymentRow,
} from "#db/repos/deployments.ts";

import {
	type ResolvedModelMetadata,
	resolveModelMetadata,
} from "#catalog/index.ts";

/** A candidate deployment of a public name (CallType-agnostic). */
export interface DeploymentCandidate {
	row: DeploymentRow;
	adapter: Adapter;
	upstreamModel: string;
	/** Effective metadata (catalog or inline catalogEntry), resolved once per candidate. */
	meta: ResolvedModelMetadata;
}

/**
 * Lists the enabled deployments of a public name whose adapter supports the given CallType.
 * Does not throw if the public model is empty: the router can skip missing fallback targets.
 */
export async function listDeploymentCandidates(
	publicModel: string,
	callType: CallType,
): Promise<DeploymentCandidate[]> {
	const rows = await listDeploymentsByPublicModel(publicModel);
	const out: DeploymentCandidate[] = [];
	for (const row of rows) {
		const adapter = getAdapter(row.adapterKey);
		if (adapter?.supportedCallTypes.has(callType)) {
			const upstreamModel = row.upstreamModel;
			const meta = resolveModelMetadata(
				row.adapterKey,
				upstreamModel,
				row.catalogEntry,
				row.pricing,
			);
			if (!(meta.supportedCallTypes ?? ["chat"]).includes(callType)) continue;
			if (
				callType === "images.generations" &&
				!imageProfileFor(meta, "generation")
			)
				continue;
			if (callType === "images.edits" && !imageProfileFor(meta, "edit"))
				continue;
			if (callType === "videos.generations" && !videoProfileFor(meta)) continue;
			if (callType === "audio.transcriptions" && !transcriptionProfileFor(meta))
				continue;
			if (callType === "embeddings" && !embeddingProfileFor(meta)) continue;
			if (callType === "rerank" && !rerankProfileFor(meta)) continue;
			out.push({ row, adapter, upstreamModel, meta });
		}
	}
	return out;
}

/** Decrypts the deployment's credentials when building the adapter context. */
export function decryptDeploymentCredentials(
	candidate: DeploymentCandidate,
): Record<string, unknown> {
	return decryptRecord(candidate.row.credentials, "deployment-credentials");
}
