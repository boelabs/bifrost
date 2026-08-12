import { env } from "#config/env.ts";

/**
 * Minimal dependency-free structured application logger.
 *
 * Emits one JSON object per line to stdout (info/debug) or stderr (warn/error), which is the
 * format log collectors (Loki, CloudWatch, Datadog, etc.) expect from a container. This is the
 * logger for *operational* events (startup, shutdown, background jobs, unexpected failures).
 * Per-operation accounting lives in `gateway_operations`, correlated JSON logs, and OpenTelemetry.
 *
 * Levels are gated by `LOG_LEVEL`. `component` namespaces a message to a subsystem so logs can be
 * filtered downstream (e.g. `log.error("redis", "connection error", { err })`).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

type Fields = Record<string, unknown>;

/** Normalizes an Error (or anything) into a serializable shape so it survives JSON.stringify. */
function serializeError(value: unknown): unknown {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			...(value.stack ? { stack: value.stack } : {}),
		};
	}
	return value;
}

function emit(
	level: LogLevel,
	component: string,
	message: string,
	fields?: Fields,
): void {
	if (LEVEL_ORDER[level] < LEVEL_ORDER[env.LOG_LEVEL]) return;

	const normalized: Fields = {};
	if (fields) {
		for (const [key, value] of Object.entries(fields)) {
			normalized[key] = key === "err" ? serializeError(value) : value;
		}
	}

	const line = JSON.stringify({
		level,
		time: new Date().toISOString(),
		component,
		message,
		...normalized,
	});

	// stderr for warn/error keeps them on the conventional stream for alerting.
	if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
	else process.stdout.write(`${line}\n`);
}

export const log = {
	debug: (component: string, message: string, fields?: Fields) =>
		emit("debug", component, message, fields),
	info: (component: string, message: string, fields?: Fields) =>
		emit("info", component, message, fields),
	warn: (component: string, message: string, fields?: Fields) =>
		emit("warn", component, message, fields),
	error: (component: string, message: string, fields?: Fields) =>
		emit("error", component, message, fields),
};
