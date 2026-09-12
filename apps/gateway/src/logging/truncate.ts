/** Optional accumulator to report (at debug level) what was truncated when persisting a log. */
export interface TruncateStats {
	/** Number of string fields that were trimmed. */
	fields: number;
	/** Total characters omitted. */
	omittedChars: number;
}

/**
 * Recursively truncates the long strings of a JSON value to store it in the DB without bloating the
 * table. Like LiteLLM: the full payload would go to external callbacks (OTEL/webhook) in later
 * phases; in the DB it is stored truncated.
 *
 * If `stats` is passed, it accumulates what was trimmed so the caller can report it (at debug).
 */
export function truncateJson(
	value: unknown,
	maxLen: number,
	stats?: TruncateStats,
): unknown {
	if (typeof value === "string") {
		if (value.length <= maxLen) return value;
		const omitted = value.length - maxLen;
		if (stats) {
			stats.fields += 1;
			stats.omittedChars += omitted;
		}
		return `${value.slice(0, maxLen)}...[truncated ${omitted} chars]`;
	}
	if (Array.isArray(value)) {
		return value.map((v) => truncateJson(v, maxLen, stats));
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value))
			out[k] = truncateJson(v, maxLen, stats);
		return out;
	}
	return value;
}
