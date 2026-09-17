import type { gatewayOperations, upstreamAttempts } from "#db/schema.ts";
import { sql } from "drizzle-orm";

/** Input is inclusive of cache reads and writes. Missing read counts stay unclassified. */
export function cacheMetrics(
	table: typeof gatewayOperations | typeof upstreamAttempts,
) {
	return {
		cacheReadTokens: sql<number | null>`sum(${table.cacheReadTokens})::float8`,
		cacheWriteTokens: sql<
			number | null
		>`sum(${table.cacheWriteTokens})::float8`,
		uncachedInputTokens: sql<
			number | null
		>`sum(greatest(${table.promptTokens} - ${table.cacheReadTokens}, 0)) filter (where ${table.promptTokens} is not null and ${table.cacheReadTokens} is not null)::float8`,
		cacheUnreportedInputTokens: sql<number>`coalesce(sum(${table.promptTokens}) filter (where ${table.cacheReadTokens} is null), 0)::float8`,
		cacheReadReported: sql<number>`count(${table.cacheReadTokens})::float8`,
		cacheWriteReported: sql<number>`count(${table.cacheWriteTokens})::float8`,
	};
}
