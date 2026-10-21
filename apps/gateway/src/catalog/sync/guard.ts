/**
 * The merge gate for automated catalog pull requests (scripts/catalog-guard.ts). The catalog agent may
 * merge its own pull request only when this finds nothing: a "block" finding means the change is not a
 * catalog sync at all and must be fixed, a "review" finding means it is plausible but risky enough that
 * a human merges it. Pure functions over parsed JSON, so the gate is testable without git.
 */

export type GuardLevel = "block" | "review";

export interface GuardFinding {
	level: GuardLevel;
	message: string;
}

/** Catalogs a script regenerates from the provider's own model list; dropping a model there is expected. */
export const GENERATED_CATALOGS: ReadonlySet<string> = new Set([
	"vercel",
	"openrouter",
]);

const CATALOG_PATH = /^apps\/gateway\/src\/adapters\/([^/]+)\/catalog\.json$/;

/**
 * A price that moves by this factor or more, either way, needs a human. Aggregator errors come in exactly
 * this shape: off-peak or batch rates passed off as standard, and promotional halves.
 */
export const PRICE_RATIO_FOR_REVIEW = 1.5;

/** The adapter directory a changed path belongs to, or undefined when it is not a catalog. */
export function catalogDirectory(path: string): string | undefined {
	return CATALOG_PATH.exec(path)?.[1];
}

export function guardChangedFiles(paths: readonly string[]): GuardFinding[] {
	return paths
		.filter((path) => catalogDirectory(path) === undefined)
		.map((path) => ({
			level: "block",
			message: `${path} is not a catalog.json; a catalog sync changes catalogs only`,
		}));
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelsOf(document: unknown): Json {
	return isRecord(document) && isRecord(document.models) ? document.models : {};
}

/** Every numeric price, keyed by its path inside `pricing` (tiers by their threshold, not their index). */
function flattenPricing(pricing: unknown): Map<string, number> {
	const prices = new Map<string, number>();
	if (!isRecord(pricing)) {
		return prices;
	}
	for (const [field, value] of Object.entries(pricing)) {
		if (typeof value === "number") {
			prices.set(field, value);
		}
	}
	const tiers = Array.isArray(pricing.tiers) ? pricing.tiers : [];
	for (const tier of tiers) {
		if (!isRecord(tier)) {
			continue;
		}
		const threshold = tier.aboveInputTokens;
		for (const [field, value] of Object.entries(tier)) {
			if (field !== "aboveInputTokens" && typeof value === "number") {
				prices.set(`tiers[>${String(threshold)}].${field}`, value);
			}
		}
	}
	return prices;
}

function priceFindings(
	label: string,
	before: unknown,
	after: unknown,
): GuardFinding[] {
	const findings: GuardFinding[] = [];
	const old = flattenPricing(before);
	const next = flattenPricing(after);
	for (const [field, oldValue] of old) {
		const newValue = next.get(field);
		if (newValue === undefined) {
			findings.push({
				level: "review",
				message: `${label}: pricing.${field} removed (was ${oldValue})`,
			});
			continue;
		}
		if (oldValue === newValue) {
			continue;
		}
		const low = Math.min(oldValue, newValue);
		const high = Math.max(oldValue, newValue);
		if (low === 0 || high / low >= PRICE_RATIO_FOR_REVIEW) {
			findings.push({
				level: "review",
				message: `${label}: pricing.${field} ${oldValue} -> ${newValue}`,
			});
		}
	}
	return findings;
}

/**
 * Compares one catalog before and after the sync. A model never disappears from a hand-maintained
 * catalog (operators' deployments reference it; retirement is `deprecated: true`), and a retirement is
 * never undone automatically.
 */
export function guardCatalog(
	directory: string,
	before: unknown,
	after: unknown,
): GuardFinding[] {
	const findings: GuardFinding[] = [];
	const old = modelsOf(before);
	const next = modelsOf(after);
	const generated = GENERATED_CATALOGS.has(directory);
	for (const [model, oldEntry] of Object.entries(old)) {
		const label = `${directory}/${model}`;
		const newEntry = next[model];
		if (newEntry === undefined) {
			if (!generated) {
				findings.push({
					level: "block",
					message: `${label} was removed; mark it deprecated instead`,
				});
			}
			continue;
		}
		if (generated || !isRecord(oldEntry) || !isRecord(newEntry)) {
			continue;
		}
		if (oldEntry.deprecated === true && newEntry.deprecated !== true) {
			findings.push({
				level: "block",
				message: `${label} is no longer deprecated; only a human reverses a retirement`,
			});
		}
		findings.push(...priceFindings(label, oldEntry.pricing, newEntry.pricing));
	}
	return findings;
}
