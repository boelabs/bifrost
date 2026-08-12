import type { CallType } from "./callType.ts";

/** Administrative safety bound; operation leases are deliberately longer than this. */
export const EXECUTION_POLICY_MAX_TOTAL_MS = 3_600_000;

export interface ExecutionPolicy {
	firstOutputMs: number;
	idleMs: number | null;
	reasoningOnlyMs: number | null;
	preCommitMs: number;
	totalMs: number;
	maxAttempts: number;
}

export interface OperationExecutionPolicies {
	json: ExecutionPolicy;
	stream: ExecutionPolicy;
}

export type ExecutionPolicies = Record<CallType, OperationExecutionPolicies>;

const policy = (
	firstOutputMs: number,
	idleMs: number | null,
	reasoningOnlyMs: number | null,
	preCommitMs: number,
	totalMs: number,
	maxAttempts: number,
): ExecutionPolicy => ({
	firstOutputMs,
	idleMs,
	reasoningOnlyMs,
	preCommitMs,
	totalMs,
	maxAttempts,
});

export const DEFAULT_EXECUTION_POLICIES: ExecutionPolicies = {
	chat: {
		json: policy(30_000, null, null, 100_000, 100_000, 6),
		stream: policy(15_000, 30_000, 90_000, 25_000, 600_000, 6),
	},
	"images.generations": {
		json: policy(60_000, null, null, 180_000, 600_000, 3),
		stream: policy(60_000, 60_000, null, 180_000, 600_000, 3),
	},
	"images.edits": {
		json: policy(60_000, null, null, 180_000, 600_000, 3),
		stream: policy(60_000, 60_000, null, 180_000, 600_000, 3),
	},
	"audio.transcriptions": {
		json: policy(60_000, null, null, 180_000, 900_000, 2),
		stream: policy(60_000, 60_000, null, 180_000, 900_000, 2),
	},
	embeddings: {
		json: policy(30_000, null, null, 60_000, 60_000, 3),
		stream: policy(30_000, null, null, 60_000, 60_000, 3),
	},
	rerank: {
		json: policy(30_000, null, null, 60_000, 60_000, 3),
		stream: policy(30_000, null, null, 60_000, 60_000, 3),
	},
	"videos.generations": {
		json: policy(60_000, null, null, 120_000, 120_000, 3),
		stream: policy(30_000, 30_000, null, 60_000, 900_000, 2),
	},
};
