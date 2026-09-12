/**
 * Returns a provider-agnostic upper bound for quota admission. One token per UTF-8 byte is
 * deliberately conservative across unknown tokenizers; requested output and materialized input
 * bounds are added explicitly. The reservation is reconciled to provider-reported usage at finish.
 */
export function estimateTokenReservation(
	payload: unknown,
	options: {
		maxOutputTokens?: number | null;
		additionalInputTokens?: number;
	} = {},
): number {
	const serialized = JSON.stringify(payload) ?? "";
	const input = Buffer.byteLength(serialized, "utf8");
	const output = positiveInteger(options.maxOutputTokens ?? 0);
	const additional = positiveInteger(options.additionalInputTokens ?? 0);
	return Math.min(Number.MAX_SAFE_INTEGER, input + output + additional);
}

function positiveInteger(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}
