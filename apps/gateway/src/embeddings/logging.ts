/** Safe operation summary: never includes the full vectors. */
export function embeddingsResponseLog(body: unknown): Record<string, unknown> {
	const response = (body ?? {}) as Record<string, unknown>;
	const data = Array.isArray(response.data) ? response.data : [];
	const dimensions = data.map((item) => {
		const embedding = (item as { embedding?: unknown })?.embedding;
		if (Array.isArray(embedding)) return embedding.length;
		if (typeof embedding === "string") return null;
		return undefined;
	});
	const encodings = new Set(
		data.map((item) => {
			const embedding = (item as { embedding?: unknown })?.embedding;
			if (Array.isArray(embedding)) return "float";
			if (typeof embedding === "string") return "base64";
			return "unknown";
		}),
	);
	return {
		object: response.object,
		model: response.model,
		count: data.length,
		encoding: encodings.size === 1 ? [...encodings][0] : [...encodings].sort(),
		dimensions:
			dimensions.length === 0
				? []
				: [...new Set(dimensions)].filter((value) => value !== undefined),
		usage: response.usage,
	};
}
