import { recordRequestTelemetry } from "#telemetry/index.ts";
import type { CostBreakdown } from "./cost.ts";
import type { Usage } from "#core/usage.ts";
import { log } from "./log.ts";

export interface OperationLogInput {
	operationId: string;
	requestId: string;
	virtualKeyId: string | null;
	publicModel: string | null;
	deploymentId: string | null;
	adapterKey: string | null;
	callType: string;
	status: "success" | "error";
	httpStatus: number | null;
	usage: Usage | null;
	cost: CostBreakdown | null;
	durationMs: number;
	/**
	 * When output began reaching the client (ms from handler entry), and `null` when that moment
	 * does not exist - a response that is not progressive has no first output distinct from its
	 * last. Filling it with the total duration in that case produces a number that is real but
	 * answers a different question, and one already recorded as `durationMs`; averaged together
	 * the two describe neither. Non-progressive responses therefore leave this null, exactly as
	 * `upstreamTtftMs` below already does.
	 */
	firstOutputMs: number | null;
	/** TTFT of the winning upstream (ms): fetch dispatch -> first token. null if there was no first token. */
	upstreamTtftMs?: number | null;
	cacheHit: boolean;
	retries: number;
	fallbackUsed: boolean;
	ip: string | null;
	userAgent: string | null;
	startTime: Date;
	endTime: Date;
	requestBody: unknown;
	responseBody: unknown;
	metadata: Record<string, unknown>;
	/** Classified error + raw provider detail. */
	error: Record<string, unknown> | null;
	/** Per-attempt router detail (AttemptRecord[]). */
	attempts?: unknown[] | null;
}

/** Emits low-cardinality telemetry; durable persistence is owned by logging/operations.ts. */
export function logOperation(input: OperationLogInput): void {
	log.info("operation", "operation completed", {
		operationId: input.operationId,
		requestId: input.requestId,
		callType: input.callType,
		publicModel: input.publicModel,
		deploymentId: input.deploymentId,
		adapterKey: input.adapterKey,
		status: input.status,
		httpStatus: input.httpStatus,
		durationMs: input.durationMs,
		firstOutputMs: input.firstOutputMs,
		retries: input.retries,
		fallbackUsed: input.fallbackUsed,
		cacheHit: input.cacheHit,
		errorCode: input.error?.code ?? null,
	});
	recordRequestTelemetry(input);
}
