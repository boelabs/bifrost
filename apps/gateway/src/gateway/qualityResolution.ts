import { type Quality, type QualityLevel, snapQuality } from "#core/quality.ts";
import type { UnsupportedParameterStrategy } from "#catalog/parameters.ts";

/**
 * What the gateway will actually ask the provider for, once a request's `quality` has been reconciled
 * with the model that is about to serve it.
 */
export interface ResolvedQuality {
	/** The rung to send, or undefined to send nothing at all. */
	quality: Quality | undefined;
	/** Set only when the effective rung differs from the requested one, for the operation log. */
	adjustedFrom?: Quality;
}

/**
 * Reconciles a requested rung with the rungs a model declares, under the operator's
 * `unsupportedParameterStrategy`:
 *
 *  - `error` — nothing is adjusted here. Validation has already rejected a rung the model does not
 *    declare, so whatever reaches this point is supported as requested.
 *  - `allow`  — the rung is forwarded verbatim and the provider decides. The operator has asked the
 *    gateway not to second-guess what a model accepts.
 *  - `drop` (the default) — the rung is snapped onto the model's ladder, or removed entirely when the
 *    model has no quality knob. This is what lets a request survive a fallback onto a deployment with
 *    a shorter ladder instead of failing on it.
 *
 * `auto` and an omitted quality are never adjusted: they express no choice, so nothing is sent and the
 * model's own default applies.
 */
export function resolveQuality(
	requested: Quality | undefined,
	levels: readonly QualityLevel[] | undefined,
	strategy: UnsupportedParameterStrategy,
): ResolvedQuality {
	if (requested === undefined || requested === "auto")
		return { quality: undefined };
	if (strategy !== "drop") return { quality: requested };

	const snapped = snapQuality(requested, levels);
	if (snapped === undefined)
		return { quality: undefined, adjustedFrom: requested };
	return snapped === requested
		? { quality: snapped }
		: { quality: snapped, adjustedFrom: requested };
}

/**
 * Returns the request to execute against a given model: the same object when nothing changes, a copy
 * carrying the effective rung otherwise. `quality` is deleted rather than set to undefined so that
 * `exactOptionalPropertyTypes` and the transports' `!== undefined` checks agree.
 */
export function withResolvedQuality<T extends { quality?: Quality }>(
	request: T,
	levels: readonly QualityLevel[] | undefined,
	strategy: UnsupportedParameterStrategy,
): { request: T; resolved: ResolvedQuality } {
	const resolved = resolveQuality(request.quality, levels, strategy);
	if (resolved.quality === request.quality) return { request, resolved };
	const next = { ...request };
	if (resolved.quality === undefined) delete next.quality;
	else next.quality = resolved.quality;
	return { request: next, resolved };
}
