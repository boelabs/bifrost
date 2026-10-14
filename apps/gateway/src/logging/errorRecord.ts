/**
 * What the operation log keeps of a failure, so "what did the upstream say?" has an answer without
 * opening a payload sample.
 *
 * The caller never sees any of this: public errors are built elsewhere. Text is bounded and scrubbed
 * of credential-shaped strings, and a deployment that seals payloads keeps only the structured part
 * (status, type, code), because a provider's message can quote the request it rejected.
 */

const MESSAGE_MAX_CHARS = 2000;

const SECRET_PATTERNS: [RegExp, string][] = [
	[/(Bearer\s+)[\w.~+/=-]{8,}/gi, "$1[redacted]"],
	[/\b(?:sk|pk|rk|sess)-[\w-]{8,}/g, "[redacted]"],
	[/\bAIza[\w-]{20,}/g, "[redacted]"],
	[
		/((?:api[_-]?key|access[_-]?token|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi,
		"$1[redacted]",
	],
];

export function scrubSecrets(input: string): string {
	let out = input;
	for (const [pattern, replacement] of SECRET_PATTERNS) {
		out = out.replace(pattern, replacement);
	}
	return out;
}

function bounded(input: string): string {
	const clean = scrubSecrets(input);
	return clean.length <= MESSAGE_MAX_CHARS
		? clean
		: `${clean.slice(0, MESSAGE_MAX_CHARS - 1)}…`;
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function scalar(value: unknown): string | undefined {
	if (typeof value === "number") {
		return String(value);
	}
	return nonEmpty(value);
}

export interface ProviderErrorDetail {
	type?: string;
	code?: string;
	param?: string;
	message?: string;
}

/**
 * The provider's own error, read from the shapes providers use: OpenAI/Anthropic
 * `{error: {type, code, param, message}}`, Google `{error: {status, code, message}}`, flat
 * `{message, code}` bodies, and plain text.
 */
export function providerErrorDetail(
	body: unknown,
	includeMessage: boolean,
): ProviderErrorDetail | null {
	if (body === undefined || body === null) {
		return null;
	}
	if (typeof body === "string") {
		return includeMessage && body.trim() !== ""
			? { message: bounded(body) }
			: null;
	}
	const root = record(body);
	if (!root) {
		return null;
	}
	const nested = record(root.error) ?? root;
	const type =
		nonEmpty(nested.type) ?? nonEmpty(nested.status) ?? nonEmpty(root.type);
	const code = scalar(nested.code);
	const param = nonEmpty(nested.param);
	const message =
		nonEmpty(nested.message) ?? nonEmpty(root.error) ?? nonEmpty(root.message);
	const detail: ProviderErrorDetail = {
		...(type === undefined ? {} : { type }),
		...(code === undefined ? {} : { code }),
		...(param === undefined ? {} : { param }),
		...(includeMessage && message !== undefined
			? { message: bounded(message) }
			: {}),
	};
	return Object.keys(detail).length > 0 ? detail : null;
}

/** The internal message, scrubbed and bounded, or nothing when the deployment seals content. */
export function internalMessage(
	message: string | undefined,
	includeMessage: boolean,
): { message: string } | Record<string, never> {
	return includeMessage && message ? { message: bounded(message) } : {};
}
