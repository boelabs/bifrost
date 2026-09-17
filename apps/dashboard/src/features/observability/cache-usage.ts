export interface CacheUsage {
	cacheReadTokens?: number | null;
	cacheWriteTokens?: number | null;
	uncachedInputTokens?: number | null;
	cacheUnreportedInputTokens?: number;
	cacheReadReported?: number;
	cacheWriteReported?: number;
}

const fields = [
	"cacheReadTokens",
	"cacheWriteTokens",
	"uncachedInputTokens",
	"cacheUnreportedInputTokens",
	"cacheReadReported",
	"cacheWriteReported",
] as const;

/** Sum observed values without turning absent provider measurements into zeroes. */
export function aggregateCacheUsage(rows: readonly CacheUsage[]): CacheUsage {
	const total: CacheUsage = {};
	for (const field of fields) {
		const values = rows
			.map((row) => row[field])
			.filter((value): value is number => typeof value === "number");
		if (values.length > 0)
			total[field] = values.reduce((sum, value) => sum + value, 0);
	}
	return total;
}

export function cacheReuseRate(row: CacheUsage): number | null {
	if (row.cacheReadTokens == null || row.uncachedInputTokens == null)
		return null;
	const classified = row.cacheReadTokens + row.uncachedInputTokens;
	return classified > 0 ? row.cacheReadTokens / classified : null;
}

export function tokenCount(value: number | null | undefined): string {
	return value == null ? "—" : new Intl.NumberFormat("en-US").format(value);
}
