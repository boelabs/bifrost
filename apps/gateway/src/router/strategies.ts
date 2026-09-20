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
	ttftMs: null,
	throughputTps: null,
	healthScore: 0.5,
};

/**
 * A pick from a candidate list the caller has already guaranteed is non-empty.
 *
 * Every strategy here is documented as taking a non-empty list, but the type cannot say so. An
 * empty one is a router bug, and this is where it says so rather than surfacing later as a
 * TypeError on a property of undefined.
 */
function pick(candidate: DeploymentCandidate | undefined): DeploymentCandidate {
	if (candidate === undefined) {
		throw new Error("Routing strategy received an empty candidate list");
	}
	return candidate;
}

function weightedRandom(
	candidates: DeploymentCandidate[],
): DeploymentCandidate {
	const total = candidates.reduce((s, c) => s + Math.max(0, c.row.weight), 0);
	if (total <= 0) {
		return pick(candidates[Math.floor(Math.random() * candidates.length)]);
	}
	let r = Math.random() * total;
	for (const c of candidates) {
		r -= Math.max(0, c.row.weight);
		if (r < 0) {
			return c;
		}
	}
	return pick(candidates.at(-1));
}

/** Picks the candidate with the lowest metric; ties -> random among the minimums. */
function pickMin(
	candidates: DeploymentCandidate[],
	metrics: Map<string, DeploymentMetrics>,
	key: "inflight" | "rpm" | "tpm",
): DeploymentCandidate {
	let min = Number.POSITIVE_INFINITY;
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
	return pick(winners[Math.floor(Math.random() * winners.length)]);
}

function pickMinScore(
	candidates: DeploymentCandidate[],
	score: (candidate: DeploymentCandidate) => number | null,
): DeploymentCandidate {
	let min = Number.POSITIVE_INFINITY;
	let winners: DeploymentCandidate[] = [];
	for (const c of candidates) {
		const v = score(c);
		if (v === null || !Number.isFinite(v)) {
			continue;
		}
		if (v < min) {
			min = v;
			winners = [c];
		} else if (v === min) {
			winners.push(c);
		}
	}
	return winners.length > 0
		? pick(winners[Math.floor(Math.random() * winners.length)])
		: weightedRandom(candidates);
}

function pickMaxScore(
	candidates: DeploymentCandidate[],
	score: (candidate: DeploymentCandidate) => number | null,
): DeploymentCandidate {
	let max = Number.NEGATIVE_INFINITY;
	let winners: DeploymentCandidate[] = [];
	for (const c of candidates) {
		const v = score(c);
		if (v === null || !Number.isFinite(v)) {
			continue;
		}
		if (v > max) {
			max = v;
			winners = [c];
		} else if (v === max) {
			winners.push(c);
		}
	}
	return winners.length > 0
		? pick(winners[Math.floor(Math.random() * winners.length)])
		: weightedRandom(candidates);
}

function priceScore(
	candidate: DeploymentCandidate,
): { basis: "tokens" | "search_units"; value: number } | null {
	const { pricing } = candidate.meta;
	if (!pricing) {
		return null;
	}
	const input = pricing.inputCentsPerMTokens ?? 0;
	const output = pricing.outputCentsPerMTokens ?? 0;
	const hasTokenPricing =
		pricing.inputCentsPerMTokens !== undefined ||
		pricing.outputCentsPerMTokens !== undefined;
	const { searchUnitCents } = pricing;
	const hasSearchUnitPricing = searchUnitCents !== undefined;
	if (hasTokenPricing === hasSearchUnitPricing) {
		return null;
	}
	return searchUnitCents === undefined
		? { basis: "tokens", value: input + output }
		: { basis: "search_units", value: searchUnitCents };
}

function pickByComparablePrice(
	candidates: DeploymentCandidate[],
): DeploymentCandidate {
	const scores = candidates.map((candidate) => priceScore(candidate));
	const basis = scores[0]?.basis;
	if (!basis || scores.some((score) => !score || score.basis !== basis)) {
		return weightedRandom(candidates);
	}
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
	if (candidates.length === 1) {
		return pick(candidates[0]);
	}
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
		default:
			throw new Error(`Unsupported routing strategy: ${strategy as string}`);
	}
}
