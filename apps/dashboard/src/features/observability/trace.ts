/**
 * Words for what the gateway recorded about a request. Pure, so the table, the detail view and the
 * page skeleton can all import it.
 */

/** A duration the way an operator reads it: ms below a second, seconds below a minute, then m s. */
export function formatDuration(ms: number | null | undefined): string {
	if (ms === null || ms === undefined || !Number.isFinite(ms)) {
		return "—";
	}
	if (ms < 1000) {
		return `${Math.round(ms)} ms`;
	}
	if (ms < 60_000) {
		const seconds = ms / 1000;
		return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`;
	}
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatBytes(bytes: number | null | undefined): string {
	if (bytes === null || bytes === undefined) {
		return "—";
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Who a failure belongs to, as recorded on the attempt. */
export const FAILURE_OWNERS = [
	{ value: "provider", label: "Provider errors" },
	{ value: "gateway_deadline", label: "Gateway deadlines" },
	{ value: "client", label: "Rejected or cancelled" },
	{ value: "deployment_config", label: "Deployment misconfigured" },
	{ value: "gateway", label: "Gateway errors" },
] as const;

export type FailureOwner = (typeof FAILURE_OWNERS)[number]["value"];

const PHASES: Record<string, string> = {
	connect: "no response",
	response: "response",
	stream: "mid-stream",
	client: "client",
	gateway: "before upstream",
	// Recorded before phases were explicit.
	headers: "response",
	streaming: "response",
	first_progress: "first output",
	rendering: "client",
};

export function phaseLabel(phase: string | null | undefined): string | null {
	if (!phase) {
		return null;
	}
	return PHASES[phase] ?? phase;
}

const KINDS: Record<string, string> = {
	upstream_server: "server error",
	bad_request: "bad request",
	rate_limit: "rate limited",
	context_window: "context too long",
	content_policy: "content policy",
	truncated: "stream cut",
	protocol: "protocol error",
	network: "network",
	timeout: "timeout",
	cancelled: "cancelled",
	auth: "auth",
	configuration: "configuration",
	internal: "internal",
};

export function kindLabel(kind: string | null | undefined): string | null {
	if (!kind) {
		return null;
	}
	return KINDS[kind] ?? kind.replaceAll("_", " ");
}

export interface FailureSummary {
	owner?: string | null;
	phase?: string | null;
	kind?: string | null;
	providerStatus?: number | null;
}

/**
 * One short phrase for a failure: whose it was, what it was, and the provider's status when there
 * was one. "Upstream 503 · server error", "Deadline · response", "Rejected 400 · bad request".
 */
export function causeLabel(failure: FailureSummary | null | undefined): string {
	if (!failure) {
		return "—";
	}
	const status = failure.providerStatus ? ` ${failure.providerStatus}` : "";
	const kind = kindLabel(failure.kind);
	switch (failure.owner) {
		case "gateway_deadline":
			return `Deadline · ${phaseLabel(failure.phase) ?? "response"}`;
		case "client":
			return failure.kind === "cancelled"
				? "Client left"
				: `Rejected${status}${kind ? ` · ${kind}` : ""}`;
		case "deployment_config":
			return `Misconfigured${status}${kind ? ` · ${kind}` : ""}`;
		case "gateway":
			return `Gateway · ${kind ?? "internal"}`;
		default:
			return `Upstream${status}${kind ? ` · ${kind}` : ""}`;
	}
}

/** Where a mark falls on a bar spanning `totalMs`, as a percentage clamped to the bar. */
export function percentOf(valueMs: number, totalMs: number): number {
	if (totalMs <= 0) {
		return 0;
	}
	return Math.min(100, Math.max(0, (valueMs / totalMs) * 100));
}

/** An operation's short name, as its page's breadcrumb gives it: the start of its UUID. */
export function shortId(id: string): string {
	return id.slice(0, 8);
}

const OPERATION_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a URL segment can name an operation. Anything else is a page that does not exist, not a
 * question for the gateway, whose database would reject it as a malformed UUID.
 */
export function isOperationId(value: string): boolean {
	return OPERATION_ID.test(value);
}
