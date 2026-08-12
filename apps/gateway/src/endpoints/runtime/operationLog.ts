import { logOperation, type OperationLogInput } from "#logging/logger.ts";
import { getRequestId } from "#http/requestContext.ts";
import type { GatewayError } from "#core/errors.ts";
import { clientIp } from "#endpoints/shared.ts";
import { getAuth } from "#auth/middleware.ts";
import type { AppEnv } from "#auth/types.ts";
import type { Usage } from "#core/usage.ts";
import type { Context } from "hono";

import {
	completeOperation,
	identifyOperation,
	newOperationId,
	beginOperation,
	touchOperation,
} from "#logging/operations.ts";

import {
	type RequestTelemetrySpan,
	finishRequestTelemetry,
	startRequestTelemetry,
} from "#telemetry/index.ts";

/** Fields the endpoint fills in when closing the request lifecycle (success or error). */
export type LogOutcome = Pick<
	OperationLogInput,
	| "status"
	| "httpStatus"
	| "usage"
	| "cost"
	| "ttftMs"
	| "responseBody"
	| "metadata"
	| "error"
>;

/** Subset of RouteResult the draft needs (avoids coupling it to the generic router). */
interface RoutingLike {
	candidate: { row: { id: string }; adapter: { key: string } };
	attempts: number;
	fallbackUsed: boolean;
	attemptLog: unknown[];
}

interface AttemptLike {
	deploymentId?: string;
	adapterKey?: string;
}

/**
 * Mutable accumulator of the durable operation record during a request's lifecycle. Centralizes the draft that
 * each endpoint used to repeat as a dozen loose `let`s plus a `writeLog` closure: built on entry,
 * progressively filled (model, routing, TTFT), and emits a single log on close.
 *
 * `applyRouting` fills in the winning attempt's fields; `applyFailedAttempts` reconstructs what is
 * known from the attempt log when `route()` fails before choosing a deployment.
 */
export class OperationLogDraft {
	/** Epoch (ms) of handler entry. Public for computing relative TTFTs. */
	readonly startedAt = Date.now();
	private readonly startTime = new Date(this.startedAt);
	/** Request correlation id (header/UUID). Public for routing and persistence. */
	readonly requestId: string;
	readonly operationId = newOperationId();
	private readonly clientAbortController = new AbortController();
	readonly clientSignal = this.clientAbortController.signal;
	private readonly operationStarted: Promise<void>;
	private readonly virtualKeyId: string | null;
	private readonly callType: string;
	private readonly ip: string | null;
	private readonly userAgent: string | null;
	private readonly telemetrySpan: RequestTelemetrySpan;

	/** Requested public model. Mutable: in text endpoints it is known after parsing the body. */
	private _publicModel: string | null = null;
	get publicModel(): string | null {
		return this._publicModel;
	}
	set publicModel(value: string | null) {
		this._publicModel = value;
		if (this.operationStarted)
			identifyOperation(
				this.operationId,
				this.operationStarted,
				this.requestId,
				value,
			);
	}
	/** Request body as it is logged (raw JSON or a reduced multipart form). */
	requestBody: unknown = undefined;
	/** TTFT of the winning upstream (ms). null if there was no first token. */
	upstreamTtftMs: number | null = null;

	private deploymentId: string | null = null;
	private adapterKey: string | null = null;
	private retries = 0;
	private fallbackUsed = false;
	private attemptLog: unknown[] | null = null;
	private lastProgressWriteAt = 0;
	private closed = false;

	constructor(
		c: Context<AppEnv>,
		callType: string,
		opts?: { publicModel?: string; requestId?: string },
	) {
		const auth = getAuth(c);
		this.requestId = opts?.requestId ?? getRequestId(c);
		c.set("operationId", this.operationId);
		this.virtualKeyId = auth.type === "virtual" ? auth.key.id : null;
		this.callType = callType;
		this.telemetrySpan = startRequestTelemetry({
			requestId: this.requestId,
			operationId: this.operationId,
			callType,
		});
		this.ip = clientIp(c);
		this.userAgent = c.req.header("user-agent") ?? null;
		if (opts?.publicModel !== undefined) this._publicModel = opts.publicModel;
		if (c.req.raw.signal.aborted) this.abortClient();
		else
			c.req.raw.signal.addEventListener("abort", () => this.abortClient(), {
				once: true,
			});
		this.operationStarted = beginOperation({
			id: this.operationId,
			requestId: this.requestId,
			virtualKeyId: this.virtualKeyId,
			callType: this.callType,
			publicModel: this._publicModel,
			startedAt: this.startTime,
		});
	}

	/** ms elapsed since entering the handler. */
	elapsedMs(): number {
		return Date.now() - this.startedAt;
	}

	/** Persists a throttled liveness heartbeat without writing once per stream chunk. */
	progress(): void {
		const now = Date.now();
		if (now - this.lastProgressWriteAt < 10_000) return;
		this.lastProgressWriteAt = now;
		touchOperation(this.operationId, this.requestId);
	}

	abortClient(): void {
		if (!this.clientAbortController.signal.aborted)
			this.clientAbortController.abort({
				owner: "client",
				type: "cancelled",
			});
	}

	/** Cancels in-flight upstream work because the downstream can no longer be served. */
	abortUpstream(): void {
		if (!this.clientAbortController.signal.aborted)
			this.clientAbortController.abort({
				owner: "gateway",
				type: "downstream_backpressure",
				phase: "rendering",
			});
	}

	/** Fills the draft with the router's winning attempt. */
	applyRouting(routing: RoutingLike): void {
		this.deploymentId = routing.candidate.row.id;
		this.adapterKey = routing.candidate.adapter.key;
		this.retries = Math.max(0, routing.attempts - 1);
		this.fallbackUsed = routing.fallbackUsed;
		this.attemptLog = routing.attemptLog;
	}

	/**
	 * Reconstructs deployment/adapter/retries from the attempt log when `route()` threw before
	 * assigning a deployment. Does not overwrite values already set by `applyRouting`.
	 */
	applyFailedAttempts(attempts: unknown[] | null | undefined): void {
		const list = (attempts ?? this.attemptLog) as AttemptLike[] | null;
		if (!list || list.length === 0) return;
		this.attemptLog = list;
		this.retries = Math.max(0, list.length - 1);
		const last = list[list.length - 1]!;
		if (this.deploymentId === null && last.deploymentId)
			this.deploymentId = last.deploymentId;
		if (this.adapterKey === null && last.adapterKey)
			this.adapterKey = last.adapterKey;
	}

	/** Always-present log fields, resolved at write time. */
	private base(): Omit<OperationLogInput, keyof LogOutcome | "cacheHit"> {
		const now = Date.now();
		return {
			operationId: this.operationId,
			requestId: this.requestId,
			virtualKeyId: this.virtualKeyId,
			publicModel: this.publicModel,
			deploymentId: this.deploymentId,
			adapterKey: this.adapterKey,
			callType: this.callType,
			durationMs: now - this.startedAt,
			upstreamTtftMs: this.upstreamTtftMs,
			retries: this.retries,
			fallbackUsed: this.fallbackUsed,
			ip: this.ip,
			userAgent: this.userAgent,
			startTime: this.startTime,
			endTime: new Date(now),
			requestBody: this.requestBody,
			attempts: this.attemptLog,
		};
	}

	/** Emits the request's final log (not a cache hit). */
	write(outcome: LogOutcome): void {
		if (this.closed) return;
		this.closed = true;
		const effectiveOutcome: LogOutcome =
			this.clientSignal.aborted && outcome.status === "success"
				? {
						...outcome,
						status: "error",
						httpStatus: 499,
						error: {
							class: "bad_request",
							code: "client_closed_request",
							failure_kind: "request",
						},
					}
				: outcome;
		const input = { ...this.base(), cacheHit: false, ...effectiveOutcome };
		logOperation(input);
		completeOperation(this.operationId, this.operationStarted, input);
		finishRequestTelemetry(this.telemetrySpan, input);
	}

	/** Shortcut for the error log from an already-normalized GatewayError. */
	writeError(error: GatewayError): void {
		this.write({
			status: "error",
			httpStatus: error.httpStatus,
			usage: null,
			cost: null,
			ttftMs: null,
			responseBody: null,
			metadata: {},
			error: error.toLog(),
		});
	}

	/** Emits the log of a response served from cache (TTFT = local serving time). */
	writeCacheHit(
		body: unknown,
		usage: Usage,
		responseBody: unknown = body,
	): void {
		if (this.closed) return;
		this.closed = true;
		const input: OperationLogInput = {
			...this.base(),
			cacheHit: true,
			status: "success",
			httpStatus: 200,
			usage,
			cost: null,
			ttftMs: this.elapsedMs(),
			responseBody,
			metadata: {
				cached: true,
				terminal: { outcome: "completed", reason: "stop", usage },
			},
			error: null,
		};
		logOperation(input);
		completeOperation(this.operationId, this.operationStarted, input);
		finishRequestTelemetry(this.telemetrySpan, input);
	}
}
