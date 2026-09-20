/**
 * The canonical quality ladder, shared by image and video generation.
 *
 * Providers expose wildly different rungs — GPT Image 2.5 goes low..max, earlier GPT Image models
 * stop at high, DALL·E has only `standard`/`hd`, Gemini image models translate the knob into a
 * thinking level, and some models have no knob at all. Rather than rejecting a request whose level a
 * particular model does not name, the gateway snaps it onto that model's rungs, exactly as
 * `snapEffort` in ./reasoning.ts does for reasoning effort. That is what makes fallback usable: a
 * request that lands on a deployment with a shorter ladder degrades instead of failing.
 *
 * `auto` is deliberately NOT a rung. It means "no choice expressed, let the model decide", so it is
 * accepted for every model — like `size: "auto"` — and never participates in snapping.
 */

/** Rungs, lowest first. Index order is the ladder. */
export const QUALITY_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

export type QualityLevel = (typeof QUALITY_ORDER)[number];

/** A canonical quality: a rung, or `auto` for "unspecified". */
export type Quality = QualityLevel | "auto";

/**
 * Vocabularies the public contract still accepts because real clients send them, normalized onto the
 * ladder on the way in so nothing provider-specific reaches `core`. A model that natively speaks one
 * of these declares the translation back in its profile's `qualityMappings`.
 */
export const LEGACY_QUALITY_ALIASES = {
	// DALL·E's pair: `standard` is its baseline, `hd` its premium tier.
	standard: "medium",
	hd: "high",
	// The video vocabulary's top rung before this ladder existed.
	native: "max",
} as const satisfies Record<string, QualityLevel>;

export type LegacyQuality = keyof typeof LEGACY_QUALITY_ALIASES;

/** Everything the public request contract accepts for `quality`. */
export const PUBLIC_QUALITY_VALUES = [
	"auto",
	...QUALITY_ORDER,
	...(Object.keys(LEGACY_QUALITY_ALIASES) as LegacyQuality[]),
] as const;

export type PublicQuality = Quality | LegacyQuality;

export function isQualityLevel(value: unknown): value is QualityLevel {
	return (
		typeof value === "string" &&
		(QUALITY_ORDER as readonly string[]).includes(value)
	);
}

/** Maps a value accepted by the public contract onto the canonical vocabulary. */
export function normalizeQuality(value: PublicQuality): Quality {
	return value in LEGACY_QUALITY_ALIASES
		? LEGACY_QUALITY_ALIASES[value as LegacyQuality]
		: (value as Quality);
}

function levelIndex(level: QualityLevel): number {
	const index = QUALITY_ORDER.indexOf(level);
	return index < 0 ? 0 : index;
}

/**
 * Snaps a requested rung onto the ones a model actually declares: the highest rung that does not
 * exceed the request, or the model's floor when the request sits below all of them. Handles
 * non-contiguous ladders (e.g. low/high, without medium) by choosing the nearest one downward, so
 * `max` on a low/high model resolves to `high` and `medium` resolves to `low`.
 *
 * Returns undefined only when the model declares no rungs at all, which means it has no quality knob
 * and the caller should send nothing.
 */
export function snapQuality(
	requested: QualityLevel,
	levels: readonly QualityLevel[] | undefined,
): QualityLevel | undefined {
	if (!levels || levels.length === 0) {
		return undefined;
	}
	const [floor, ...rest] = [...levels].sort(
		(a, b) => levelIndex(a) - levelIndex(b),
	);
	if (floor === undefined) {
		return undefined;
	}
	const sorted = [floor, ...rest];
	const requestedIndex = levelIndex(requested);
	let chosen = floor; // the floor, if the request is below every rung
	for (const level of sorted) {
		if (levelIndex(level) <= requestedIndex) {
			chosen = level;
		} else {
			break;
		}
	}
	return chosen;
}
