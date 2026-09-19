/** Safe operation summary: never includes the full vectors. */
export function embeddingsResponseLog(body: unknown): Record<string, unknown> {
	const response = (body ?? {}) as Record<string, unknown>;
	const data = Array.isArray(response.data) ? response.data : [];
	// Anything that is neither a vector nor a base64 string contributes no dimension at all.
	const dimensions: (number | null)[] = [];
	for (const item of data) {
		const embedding = (item as { embedding?: unknown })?.embedding;
		if (Array.isArray(embedding)) {
			dimensions.push(embedding.length);
		} else if (typeof embedding === "string") {
			dimensions.push(null);
		}
	}
	const encodings = new Set(
		data.map((item) => {
			const embedding = (item as { embedding?: unknown })?.embedding;
			if (Array.isArray(embedding)) {
				return "float";
			}
			if (typeof embedding === "string") {
				return "base64";
			}
			return "unknown";
		}),
	);
	return {
		object: response.object,
		model: response.model,
		count: data.length,
		encoding: encodings.size === 1 ? [...encodings][0] : [...encodings].sort(),
		dimensions: [...new Set(dimensions)],
		usage: response.usage,
	};
}
