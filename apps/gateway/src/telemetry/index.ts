import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { OperationLogInput } from "#logging/logger.ts";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { log } from "#logging/log.ts";
import { env } from "#config/env.ts";

import {
	type Attributes,
	SpanStatusCode,
	type Context,
	type Span,
	context,
	metrics,
	trace,
} from "@opentelemetry/api";

let sdk: NodeSDK | null = null;

const tracer = trace.getTracer("bifrost");
const operationContexts = new Map<string, Context>();

/**
 * The metric instruments are created AFTER sdk.start() so they use the real MeterProvider (instruments
 * created before registering the provider would stay on a no-op meter and would not export). They are
 * stored here and recordRequestTelemetry uses them only if they exist.
 */
interface Instruments {
	requestCounter: ReturnType<
		ReturnType<typeof metrics.getMeter>["createCounter"]
	>;
	errorCounter: ReturnType<
		ReturnType<typeof metrics.getMeter>["createCounter"]
	>;
	requestDuration: ReturnType<
		ReturnType<typeof metrics.getMeter>["createHistogram"]
	>;
	upstreamDuration: ReturnType<
		ReturnType<typeof metrics.getMeter>["createHistogram"]
	>;
	tokenCounter: ReturnType<
		ReturnType<typeof metrics.getMeter>["createCounter"]
	>;
	searchUnitCounter: ReturnType<
		ReturnType<typeof metrics.getMeter>["createCounter"]
	>;
	costCounter: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
	outcomeCounter: ReturnType<
		ReturnType<typeof metrics.getMeter>["createCounter"]
	>;
	retryCounter: ReturnType<
		ReturnType<typeof metrics.getMeter>["createCounter"]
	>;
	fallbackCounter: ReturnType<
		ReturnType<typeof metrics.getMeter>["createCounter"]
	>;
	persistenceQueueDepth: ReturnType<
		ReturnType<typeof metrics.getMeter>["createUpDownCounter"]
	>;
	persistenceLosses: ReturnType<
		ReturnType<typeof metrics.getMeter>["createCounter"]
	>;
	activeOperations: ReturnType<
		ReturnType<typeof metrics.getMeter>["createUpDownCounter"]
	>;
	activeAttempts: ReturnType<
		ReturnType<typeof metrics.getMeter>["createUpDownCounter"]
	>;
	firstEvent: ReturnType<
		ReturnType<typeof metrics.getMeter>["createHistogram"]
	>;
	firstReasoning: ReturnType<
		ReturnType<typeof metrics.getMeter>["createHistogram"]
	>;
	firstOutput: ReturnType<
		ReturnType<typeof metrics.getMeter>["createHistogram"]
	>;
	maxEventGap: ReturnType<
		ReturnType<typeof metrics.getMeter>["createHistogram"]
	>;
}
let inst: Instruments | null = null;

function createInstruments(): Instruments {
	const meter = metrics.getMeter("bifrost");
	return {
		requestCounter: meter.createCounter("bifrost_requests_total", {
			description: "Total completed gateway operations.",
		}),
		errorCounter: meter.createCounter("bifrost_errors_total", {
			description: "Total failed gateway operations.",
		}),
		requestDuration: meter.createHistogram("bifrost_request_duration_ms", {
			description: "Gateway request duration in milliseconds.",
			unit: "ms",
		}),
		upstreamDuration: meter.createHistogram("bifrost_upstream_ttft_ms", {
			description:
				"Upstream time-to-first-token in milliseconds (winning attempt).",
			unit: "ms",
		}),
		tokenCounter: meter.createCounter("bifrost_tokens_total", {
			description: "Total tokens reported by upstream providers.",
		}),
		searchUnitCounter: meter.createCounter("bifrost_search_units_total", {
			description:
				"Total reranking search units reported by upstream providers.",
		}),
		costCounter: meter.createCounter("bifrost_cost_cents_total", {
			description: "Total estimated request cost in USD cents.",
		}),
		outcomeCounter: meter.createCounter("bifrost_outcomes_total", {
			description: "Completed gateway operations by semantic outcome.",
		}),
		retryCounter: meter.createCounter("bifrost_retries_total", {
			description: "Upstream retries beyond the first attempt.",
		}),
		fallbackCounter: meter.createCounter("bifrost_fallbacks_total", {
			description: "Operations that selected a configured fallback model.",
		}),
		persistenceQueueDepth: meter.createUpDownCounter(
			"bifrost_persistence_queue_depth",
			{ description: "Pending operation finalizations in this process." },
		),
		persistenceLosses: meter.createCounter("bifrost_persistence_losses_total", {
			description: "Operation finalizations dropped or failed after retries.",
		}),
		activeOperations: meter.createUpDownCounter("bifrost_active_operations", {
			description: "Operations active in this gateway process.",
		}),
		activeAttempts: meter.createUpDownCounter(
			"bifrost_active_upstream_attempts",
			{ description: "Upstream attempts active in this gateway process." },
		),
		firstEvent: meter.createHistogram("bifrost_first_event_ms", {
			description: "Time from ingress to first upstream event.",
			unit: "ms",
		}),
		firstReasoning: meter.createHistogram("bifrost_first_reasoning_ms", {
			description: "Time from ingress to first reasoning output.",
			unit: "ms",
		}),
		firstOutput: meter.createHistogram("bifrost_first_output_ms", {
			description: "Time from ingress to first useful output.",
			unit: "ms",
		}),
		maxEventGap: meter.createHistogram("bifrost_max_event_gap_ms", {
			description: "Largest observed gap between upstream stream events.",
			unit: "ms",
		}),
	};
}

export function startTelemetry(): void {
	if (!env.OTEL_ENABLED || sdk) return;

	const metricReader = new PeriodicExportingMetricReader({
		exporter: new OTLPMetricExporter(),
		exportIntervalMillis: env.OTEL_METRIC_EXPORT_INTERVAL_MS,
	});

	sdk = new NodeSDK({
		serviceName: env.OTEL_SERVICE_NAME,
		resource: resourceFromAttributes({
			"service.name": env.OTEL_SERVICE_NAME,
			"deployment.environment": env.NODE_ENV,
		}),
		traceExporter: new OTLPTraceExporter(),
		metricReaders: [metricReader],
		instrumentations: [new HttpInstrumentation()],
	});
	sdk.start();
	inst = createInstruments(); // after start(): the real provider is registered
	log.info("otel", "enabled", { service: env.OTEL_SERVICE_NAME });
}

export async function shutdownTelemetry(): Promise<void> {
	if (!sdk) return;
	await sdk.shutdown();
	sdk = null;
}

export function recordPersistenceQueueDelta(delta: number): void {
	inst?.persistenceQueueDepth.add(delta);
}

export function recordPersistenceLoss(kind: "dropped" | "failed"): void {
	inst?.persistenceLosses.add(1, { kind });
}

export interface OperationChildTelemetrySpan {
	span: Span;
	ended: boolean;
}

export function startOperationChildTelemetry(
	operationId: string,
	name: "routing" | "stream" | "render" | "persistence",
): OperationChildTelemetrySpan {
	return {
		span: tracer.startSpan(
			`bifrost.${name}`,
			undefined,
			operationContexts.get(operationId) ?? context.active(),
		),
		ended: false,
	};
}

export function finishOperationChildTelemetry(
	handle: OperationChildTelemetrySpan,
	errorCode?: string | null,
): void {
	if (handle.ended) return;
	handle.ended = true;
	if (errorCode) {
		handle.span.setAttribute("error.code", errorCode);
		handle.span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode });
	}
	handle.span.end();
}

function baseAttributes(input: OperationLogInput): Attributes {
	return {
		"model.public_name": input.publicModel ?? "unknown",
		"deployment.id": input.deploymentId ?? "unknown",
		"adapter.key": input.adapterKey ?? "unknown",
		"call.type": input.callType,
		"gateway.status": input.status,
		"http.status_code": input.httpStatus ?? 0,
		"cache.hit": input.cacheHit,
		"fallback.used": input.fallbackUsed,
		retries: input.retries,
	};
}

export interface RequestTelemetrySpan {
	span: Span;
	ended: boolean;
	operationId: string;
}

export function startRequestTelemetry(input: {
	requestId: string;
	operationId: string;
	callType: string;
}): RequestTelemetrySpan {
	const parent = context.active();
	const span = tracer.startSpan(
		"bifrost.operation",
		{
			attributes: {
				"request.id": input.requestId,
				"operation.id": input.operationId,
				"call.type": input.callType,
			},
		},
		parent,
	);
	operationContexts.set(input.operationId, trace.setSpan(parent, span));
	inst?.activeOperations.add(1, { "call.type": input.callType });
	return {
		span,
		ended: false,
		operationId: input.operationId,
	};
}

export function finishRequestTelemetry(
	handle: RequestTelemetrySpan,
	input: OperationLogInput,
): void {
	if (handle.ended) return;
	handle.ended = true;
	handle.span.setAttributes(baseAttributes(input));
	if (input.status === "error")
		handle.span.setStatus({
			code: SpanStatusCode.ERROR,
			message: String(input.error?.code ?? "gateway_error"),
		});
	handle.span.addEvent("bifrost.operation.finished", {
		"error.code": String(input.error?.code ?? ""),
		"terminal.verified": Boolean(
			(input.metadata.terminal as unknown) ??
				(input.metadata.streamLifecycle as { terminal?: unknown } | undefined)
					?.terminal,
		),
	});
	handle.span.end(input.endTime.getTime());
	operationContexts.delete(handle.operationId);
	inst?.activeOperations.add(-1, { "call.type": input.callType });
}

export interface UpstreamAttemptTelemetrySpan {
	span: Span;
	ended: boolean;
	adapterKey: string;
	transport: string;
}

export function startUpstreamAttemptTelemetry(input: {
	requestId: string;
	operationId?: string;
	ordinal: number;
	deploymentId: string;
	adapterKey: string;
	transport: string;
	upstreamModel: string;
	startedAt: number;
}): UpstreamAttemptTelemetrySpan {
	inst?.activeAttempts.add(1, {
		"adapter.key": input.adapterKey,
		"upstream.transport": input.transport,
	});
	return {
		span: tracer.startSpan(
			"bifrost.upstream_attempt",
			{
				startTime: input.startedAt,
				attributes: {
					"request.id": input.requestId,
					...(input.operationId ? { "operation.id": input.operationId } : {}),
					"attempt.ordinal": input.ordinal,
					"deployment.id": input.deploymentId,
					"adapter.key": input.adapterKey,
					"upstream.transport": input.transport,
					"model.upstream": input.upstreamModel,
				},
			},
			input.operationId
				? operationContexts.get(input.operationId)
				: context.active(),
		),
		ended: false,
		adapterKey: input.adapterKey,
		transport: input.transport,
	};
}

export function finishUpstreamAttemptTelemetry(
	handle: UpstreamAttemptTelemetrySpan,
	input: {
		endedAt: number;
		outcome: string;
		terminalVerified: boolean;
		errorCode?: string | null;
	},
): void {
	if (handle.ended) return;
	handle.ended = true;
	handle.span.setAttributes({
		"attempt.outcome": input.outcome,
		"terminal.verified": input.terminalVerified,
		...(input.errorCode ? { "error.code": input.errorCode } : {}),
	});
	if (input.errorCode)
		handle.span.setStatus({
			code: SpanStatusCode.ERROR,
			message: input.errorCode,
		});
	handle.span.end(input.endedAt);
	inst?.activeAttempts.add(-1, {
		"adapter.key": handle.adapterKey,
		"upstream.transport": handle.transport,
	});
}

export function recordRequestTelemetry(input: OperationLogInput): void {
	if (!env.OTEL_ENABLED || !inst) return;

	const attrs = baseAttributes(input);
	inst.requestCounter.add(1, attrs);
	inst.requestDuration.record(input.durationMs, attrs);
	if (input.upstreamTtftMs != null)
		inst.upstreamDuration.record(input.upstreamTtftMs, attrs);
	if (input.status === "error") inst.errorCounter.add(1, attrs);
	if (input.usage?.totalTokens)
		inst.tokenCounter.add(input.usage.totalTokens, attrs);
	if (input.usage?.searchUnits)
		inst.searchUnitCounter.add(input.usage.searchUnits, attrs);
	if (input.cost?.totalCents)
		inst.costCounter.add(input.cost.totalCents, attrs);
	const lifecycle = input.metadata.streamLifecycle as
		| {
				firstEventAt?: number | null;
				firstReasoningAt?: number | null;
				firstOutputAt?: number | null;
				maxInterEventGapMs?: number;
				terminal?: { outcome?: string } | null;
		  }
		| undefined;
	const terminal =
		lifecycle?.terminal ??
		(input.metadata.terminal as { outcome?: string } | undefined);
	const outcome =
		input.status === "error" ? "error" : (terminal?.outcome ?? "unknown");
	inst.outcomeCounter.add(1, {
		...attrs,
		"gateway.outcome": outcome,
		"gateway.degraded":
			input.retries > 0 ||
			input.fallbackUsed ||
			outcome === "incomplete" ||
			outcome === "blocked",
	});
	if (input.retries > 0) inst.retryCounter.add(input.retries, attrs);
	if (input.fallbackUsed) inst.fallbackCounter.add(1, attrs);
	if (lifecycle?.firstEventAt != null)
		inst.firstEvent.record(
			lifecycle.firstEventAt - input.startTime.getTime(),
			attrs,
		);
	if (lifecycle?.firstReasoningAt != null)
		inst.firstReasoning.record(
			lifecycle.firstReasoningAt - input.startTime.getTime(),
			attrs,
		);
	if (lifecycle?.firstOutputAt != null)
		inst.firstOutput.record(
			lifecycle.firstOutputAt - input.startTime.getTime(),
			attrs,
		);
	else if (input.ttftMs != null) inst.firstOutput.record(input.ttftMs, attrs);
	if (lifecycle?.maxInterEventGapMs != null)
		inst.maxEventGap.record(lifecycle.maxInterEventGapMs, attrs);
}
