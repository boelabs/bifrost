import type { DeploymentCandidate } from "#gateway/deploymentCandidates.ts";
import type { RoutingStrategy } from "./settings.ts";
import type { DeploymentMetrics } from "./state.ts";

// healthScore: 0.5 (neutral), matching fetchMetrics' default for a deployment with no recorded
// attempts - see NEUTRAL_HEALTH_SCORE in router/state.ts for why this isn't 1 (perfect).
const ZERO: DeploymentMetrics = {
	inflight: 0,
	rpm: 0,
	tpm: 0,
	successes: 0,
	failures: 0,
	latencyMs: null,
	throughputTps: null,
	healthScore: 0.5,
};

function weightedRandom(
	candidates: DeploymentCandidate[],
): DeploymentCandidate {
	const total = candidates.reduce((s, c) => s + Math.max(0, c.row.weight), 0);
	if (total <= 0)
		return candidates[Math.floor(Math.random() * candidates.length)]!;
	let r = Math.random() * total;
	for (const c of candidates) {
		r -= Math.max(0, c.row.weight);
		if (r < 0) return c;
	}
	return candidates[candidates.length - 1]!;
}

/** Picks the candidate with the lowest metric; ties -> random among the minimums. */
function pickMin(
	candidates: DeploymentCandidate[],
	metrics: Map<string, DeploymentMetrics>,
	key: "inflight" | "rpm" | "tpm",
): DeploymentCandidate {
	let min = Infinity;
	let winners: DeploymentCandidate[] = [];
	for (const c of candidates) {
		const v = (metrics.get(c.row.id) ?? ZERO)[key];
		if (v < min) {
			min = v;
			winners = [c];
		} else if (v === min) {
			winners.push(c);
		}
	}
	return winners[Math.floor(Math.random() * winners.length)]!;
}

function pickMinScore(
	candidates: DeploymentCandidate[],
	score: (candidate: DeploymentCandidate) => number | null,
): DeploymentCandidate {
	let min = Infinity;
	let winners: DeploymentCandidate[] = [];
	for (const c of candidates) {
		const v = score(c);
		if (v === null || !Number.isFinite(v)) continue;
		if (v < min) {
			min = v;
			winners = [c];
		} else if (v === min) {
			winners.push(c);
		}
	}
	return winners.length > 0
		? winners[Math.floor(Math.random() * winners.length)]!
		: weightedRandom(candidates);
}

function pickMaxScore(
	candidates: DeploymentCandidate[],
	score: (candidate: DeploymentCandidate) => number | null,
): DeploymentCandidate {
	let max = -Infinity;
	let winners: DeploymentCandidate[] = [];
	for (const c of candidates) {
		const v = score(c);
		if (v === null || !Number.isFinite(v)) continue;
		if (v > max) {
			max = v;
			winners = [c];
		} else if (v === max) {
			winners.push(c);
		}
	}
	return winners.length > 0
		? winners[Math.floor(Math.random() * winners.length)]!
		: weightedRandom(candidates);
}

function priceScore(
	candidate: DeploymentCandidate,
): { basis: "tokens" | "search_units"; value: number } | null {
	const pricing = candidate.meta.pricing;
	if (!pricing) return null;
	const input = pricing.inputCentsPerMTokens ?? 0;
	const output = pricing.outputCentsPerMTokens ?? 0;
	const hasTokenPricing =
		pricing.inputCentsPerMTokens !== undefined ||
		pricing.outputCentsPerMTokens !== undefined;
	const hasSearchUnitPricing = pricing.searchUnitCents !== undefined;
	if (hasTokenPricing === hasSearchUnitPricing) return null;
	return hasSearchUnitPricing
		? { basis: "search_units", value: pricing.searchUnitCents! }
		: { basis: "tokens", value: input + output };
}

function pickByComparablePrice(
	candidates: DeploymentCandidate[],
): DeploymentCandidate {
	const scores = candidates.map((candidate) => priceScore(candidate));
	const basis = scores[0]?.basis;
	if (!basis || scores.some((score) => !score || score.basis !== basis))
		return weightedRandom(candidates);
	return pickMinScore(
		candidates,
		(candidate) => priceScore(candidate)?.value ?? null,
	);
}

/**
 * Pure selector: given a strategy, candidates, and their current metrics, picks one.
 * `candidates` must be non-empty. (Metric fetching lives in the router.)
 */
export function pickDeployment(
	strategy: RoutingStrategy,
	candidates: DeploymentCandidate[],
	metrics: Map<string, DeploymentMetrics>,
): DeploymentCandidate {
	if (candidates.length === 1) return candidates[0]!;
	switch (strategy) {
		case "least-busy":
			return pickMin(candidates, metrics, "inflight");
		case "usage-based-tpm":
			return pickMin(candidates, metrics, "tpm");
		case "usage-based-rpm":
			return pickMin(candidates, metrics, "rpm");
		case "latency-based":
			return pickMinScore(
				candidates,
				(candidate) => metrics.get(candidate.row.id)?.latencyMs ?? null,
			);
		case "throughput-based":
			return pickMaxScore(
				candidates,
				(candidate) => metrics.get(candidate.row.id)?.throughputTps ?? null,
			);
		case "price-based":
			return pickByComparablePrice(candidates);
		case "health-aware":
			return pickMaxScore(
				candidates,
				(candidate) =>
					(metrics.get(candidate.row.id) ?? ZERO).healthScore *
					Math.max(0, candidate.row.weight),
			);
		case "simple-shuffle":
			return weightedRandom(candidates);
	}
}
