import { mergeCatalogEntry, type MergeResult } from "#catalog/sync/merge.ts";
import { readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import type { ReasoningControlKind } from "#core/reasoning.ts";
import { matchCandidates } from "#catalog/sync/match.ts";
import type { CatalogEntry } from "#catalog/types.ts";
import { MODEL_CATALOG } from "#adapters/index.ts";

import type {
	EnrichmentSourceKey,
	ExistenceSourceKey,
	SourceFetchResult,
	EnrichmentSource,
	EnrichmentModel,
	CatalogSource,
} from "#catalog/sync/types.ts";

import {
	ACTIVE_ENRICHMENT_SOURCES,
	ACTIVE_EXISTENCE_SOURCES,
} from "#catalog/sync/sources/index.ts";

import {
	assertProviderIdentityRegistered,
	normalizeTag,
} from "#catalog/sync/providerIdentity.ts";

import {
	type DeprecationCandidate,
	findDeprecations,
} from "#catalog/sync/deprecate.ts";

import {
	type CatalogDocument,
	loadCatalogDocument,
} from "#catalog/jsonCatalog.ts";

import {
	updateHistory,
	writeHistory,
	loadHistory,
} from "#catalog/sync/history.ts";

import {
	findModelsDevMatch,
	enrichCatalogEntry,
} from "#catalog/sync/enrich.ts";

type Mode = "report" | "verify";

function argValue(name: string): string | undefined {
	const prefix = `${name}=`;
	const directIndex = process.argv.indexOf(name);
	if (directIndex >= 0) return process.argv[directIndex + 1];
	const item = process.argv.find((arg) => arg.startsWith(prefix));
	return item?.slice(prefix.length);
}

function mode(): Mode {
	const raw = argValue("--mode") ?? "report";
	if (raw === "report" || raw === "verify") return raw;
	throw new Error("--mode must be report or verify");
}

function optionalLimit(): number | undefined {
	const raw = argValue("--limit");
	if (raw === undefined) return undefined;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0)
		throw new Error("--limit must be a positive integer");
	return value;
}

function sourcesFilter(): Set<string> | undefined {
	const raw = argValue("--sources");
	return raw ? new Set(raw.split(",").map((s) => s.trim())) : undefined;
}

/** One HTTP-failure at the whole-source level (not just a per-model call) must never take down the run. */
async function fetchExistenceResults(
	sources: readonly CatalogSource[],
): Promise<SourceFetchResult[]> {
	const settled = await Promise.allSettled(sources.map((s) => s.fetchModels()));
	return settled.map((result, index) => {
		const source = sources[index]!;
		if (result.status === "fulfilled") return result.value;
		console.error(
			`source ${source.key} failed entirely: ${String(result.reason)}`,
		);
		return {
			source: source.key,
			models: [],
			attempted: 0,
			failed: [],
			complete: false,
		};
	});
}

async function fetchEnrichmentModels(
	sources: readonly EnrichmentSource[],
): Promise<EnrichmentModel[]> {
	const settled = await Promise.allSettled(sources.map((s) => s.fetchModels()));
	const models: EnrichmentModel[] = [];
	settled.forEach((result, index) => {
		if (result.status === "fulfilled") {
			models.push(...result.value.models);
		} else {
			console.error(
				`enrichment source ${sources[index]!.key} failed entirely: ${String(result.reason)}`,
			);
		}
	});
	return models;
}

interface CatalogFile {
	url: URL;
	document: CatalogDocument;
}

function loadCatalogFiles(): Map<string, CatalogFile> {
	const adaptersDir = new URL("../src/adapters/", import.meta.url);
	const catalogs = new Map<string, CatalogFile>();
	for (const dirent of readdirSync(adaptersDir, { withFileTypes: true })) {
		if (!dirent.isDirectory()) continue;
		const url = new URL(`${dirent.name}/catalog.json`, adaptersDir);
		if (!existsSync(url)) continue;
		const document = loadCatalogDocument(url);
		catalogs.set(document.provider.adapterKey, { url, document });
	}
	return catalogs;
}

function findExistingKey(
	models: Record<string, CatalogEntry>,
	upstreamModel: string,
): string | undefined {
	if (models[upstreamModel]) return upstreamModel;
	const normalized = normalizeTag(upstreamModel);
	return Object.keys(models).find((key) => normalizeTag(key) === normalized);
}

/** Existing `kind` values already declared per adapter, in first-seen order - a hint for enrich.ts's draft. */
function collectKindsInUseByAdapter(
	catalogs: ReadonlyMap<string, CatalogFile>,
): Map<string, ReasoningControlKind[]> {
	const result = new Map<string, ReasoningControlKind[]>();
	for (const [adapterKey, { document }] of catalogs) {
		const seen: ReasoningControlKind[] = [];
		for (const entry of Object.values(document.models)) {
			const kind = entry.operations["text.generate"]?.reasoning?.kind;
			if (kind && !seen.includes(kind)) seen.push(kind);
		}
		if (seen.length > 0) result.set(adapterKey, seen);
	}
	return result;
}

interface RunSummary {
	generatedAt: string;
	mode: Mode;
	existenceSources: Array<{
		key: ExistenceSourceKey;
		attempted: number;
		failed: number;
		complete: boolean;
	}>;
	enrichmentSources: EnrichmentSourceKey[];
	matchedCount: number;
	confirmedCount: number;
	lowConfidence: Array<{
		adapterKey: string;
		upstreamModel: string;
		sources: string[];
	}>;
	newEntries: Array<{
		adapterKey: string;
		upstreamModel: string;
		changes: string[];
		/** Fully drafted entry, ready for a human to review and paste into the adapter's catalog.json. */
		entry: CatalogEntry;
	}>;
	updatedEntries: Array<{
		adapterKey: string;
		upstreamModel: string;
		changes: string[];
	}>;
	conflicts: Array<{
		adapterKey: string;
		upstreamModel: string;
		conflicts: MergeResult["conflicts"];
	}>;
	needsHumanReview: Array<{
		adapterKey: string;
		upstreamModel: string;
		paths: string[];
	}>;
	ambiguousModelsDevMatches: Array<{
		adapterKey: string;
		upstreamModel: string;
		modelsDevId: string;
	}>;
	deprecations: DeprecationCandidate[];
}

async function run(): Promise<void> {
	assertProviderIdentityRegistered(Object.keys(MODEL_CATALOG));
	const runMode = mode();
	const limit = optionalLimit();
	const filter = sourcesFilter();

	const existenceSources = ACTIVE_EXISTENCE_SOURCES.filter(
		(s) => !filter || filter.has(s.key),
	);
	const enrichmentSources = ACTIVE_ENRICHMENT_SOURCES.filter(
		(s) => !filter || filter.has(s.key),
	);

	let existenceResults = await fetchExistenceResults(existenceSources);
	if (limit) {
		// A --limit'd run is truncated by definition, not just "fetch partially failed" - but it must be
		// treated exactly as unsafe for deprecation: without this, most of the catalog would look "absent
		// this run" simply because it was never in the truncated slice, and get mass-deprecated.
		existenceResults = existenceResults.map((result) => ({
			...result,
			models: result.models.slice(0, limit),
			complete: false,
		}));
		console.log(
			`--limit ${limit} applied: deprecation is skipped for this run.`,
		);
	}
	const modelsDevModels = await fetchEnrichmentModels(enrichmentSources);

	const matched = matchCandidates(existenceResults);
	const catalogs = loadCatalogFiles();
	const kindsInUseByAdapter = collectKindsInUseByAdapter(catalogs);

	// Local-only state (`.source/` is gitignored): the sync never writes inside src/ anymore.
	const historyUrl = new URL(
		"../.source/catalog-sync/history.json",
		import.meta.url,
	);
	const history = updateHistory(loadHistory(historyUrl), matched);

	const summary: RunSummary = {
		generatedAt: new Date().toISOString(),
		mode: runMode,
		existenceSources: existenceResults.map((r) => ({
			key: r.source,
			attempted: r.attempted,
			failed: r.failed.length,
			complete: r.complete,
		})),
		enrichmentSources: enrichmentSources.map((s) => s.key),
		matchedCount: matched.length,
		confirmedCount: matched.filter((c) => c.confirmed).length,
		lowConfidence: [],
		newEntries: [],
		updatedEntries: [],
		conflicts: [],
		needsHumanReview: [],
		ambiguousModelsDevMatches: [],
		deprecations: [],
	};

	for (const candidate of matched) {
		const catalog = catalogs.get(candidate.adapterKey);
		if (!catalog) continue; // adapter has no catalog.json (e.g. openaicompatible) - nothing to sync into

		const existingKey = findExistingKey(
			catalog.document.models,
			candidate.upstreamModel,
		);
		const modelsDevFound = findModelsDevMatch(candidate, modelsDevModels);
		const modelsDevMatch = modelsDevFound?.corroborated
			? modelsDevFound.match
			: undefined;
		if (modelsDevFound && !modelsDevFound.corroborated) {
			summary.ambiguousModelsDevMatches.push({
				adapterKey: candidate.adapterKey,
				upstreamModel: candidate.upstreamModel,
				modelsDevId: `${modelsDevFound.match.providerIdRaw}/${modelsDevFound.match.modelIdRaw}`,
			});
		}

		if (existingKey) {
			const existing = catalog.document.models[existingKey]!;
			const merged = mergeCatalogEntry(existing, candidate, modelsDevMatch);
			const enriched = enrichCatalogEntry(
				merged.entry,
				candidate,
				modelsDevMatch,
				kindsInUseByAdapter,
			);
			const changes = [...merged.changes, ...enriched.changes];
			if (merged.conflicts.length > 0) {
				summary.conflicts.push({
					adapterKey: candidate.adapterKey,
					upstreamModel: candidate.upstreamModel,
					conflicts: merged.conflicts,
				});
			}
			if (enriched.entry.needsHumanReview?.length) {
				summary.needsHumanReview.push({
					adapterKey: candidate.adapterKey,
					upstreamModel: candidate.upstreamModel,
					paths: enriched.entry.needsHumanReview,
				});
			}
			if (changes.length > 0) {
				summary.updatedEntries.push({
					adapterKey: candidate.adapterKey,
					upstreamModel: candidate.upstreamModel,
					changes,
				});
			}
			continue;
		}

		if (!candidate.confirmed) {
			summary.lowConfidence.push({
				adapterKey: candidate.adapterKey,
				upstreamModel: candidate.upstreamModel,
				sources: Object.keys(candidate.bySource),
			});
			continue;
		}

		// Confirmed by both existence sources, no catalog entry yet: create one from a near-empty stub, run
		// through the exact same merge + enrich path an existing entry's refresh takes.
		const stub: CatalogEntry = { operations: {} };
		const merged = mergeCatalogEntry(stub, candidate, modelsDevMatch);
		const enriched = enrichCatalogEntry(
			merged.entry,
			candidate,
			modelsDevMatch,
			kindsInUseByAdapter,
		);
		if (merged.conflicts.length > 0) {
			summary.conflicts.push({
				adapterKey: candidate.adapterKey,
				upstreamModel: candidate.upstreamModel,
				conflicts: merged.conflicts,
			});
		}
		if (enriched.entry.needsHumanReview?.length) {
			summary.needsHumanReview.push({
				adapterKey: candidate.adapterKey,
				upstreamModel: candidate.upstreamModel,
				paths: enriched.entry.needsHumanReview,
			});
		}
		summary.newEntries.push({
			adapterKey: candidate.adapterKey,
			upstreamModel: candidate.upstreamModel,
			changes: [...merged.changes, ...enriched.changes],
			entry: enriched.entry,
		});
	}

	const catalogsByAdapter = new Map(
		[...catalogs.entries()].map(([adapterKey, { document }]) => [
			adapterKey,
			document.models,
		]),
	);
	summary.deprecations = findDeprecations(
		catalogsByAdapter,
		matched,
		existenceResults,
		history.confirmed,
	);

	logSummary(summary);
	if (runMode === "report") {
		writeReport(summary);
		writeHistory(historyUrl, history);
	}
	if (
		runMode === "verify" &&
		(summary.newEntries.length > 0 ||
			summary.updatedEntries.length > 0 ||
			summary.deprecations.length > 0 ||
			summary.conflicts.length > 0)
	) {
		process.exitCode = 1;
	}
}

function logSummary(summary: RunSummary): void {
	console.log(
		`catalog sync (${summary.mode}): ${summary.confirmedCount}/${summary.matchedCount} confirmed, ` +
			`${summary.newEntries.length} new, ${summary.updatedEntries.length} updated, ` +
			`${summary.deprecations.length} deprecated, ${summary.conflicts.length} conflicts, ` +
			`${summary.needsHumanReview.length} need reasoning review, ` +
			`${summary.lowConfidence.length} low-confidence, ${summary.ambiguousModelsDevMatches.length} ambiguous models.dev matches`,
	);
	for (const source of summary.existenceSources) {
		console.log(
			`  ${source.key}: ${source.attempted - source.failed}/${source.attempted} fetched` +
				(source.complete ? "" : " (INCOMPLETE - deprecation skipped this run)"),
		);
	}
}

/**
 * Everything the sync produces lands here, and only here (`.source/` is gitignored): the catalogs in
 * src/adapters are applied exclusively by a human, using REPORT.md as the worksheet.
 */
function writeReport(summary: RunSummary): void {
	const dir = new URL("../.source/catalog-sync/", import.meta.url);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		new URL("report.json", dir),
		`${JSON.stringify(summary, null, 2)}\n`,
	);
	console.log(`wrote ${new URL("report.json", dir).pathname}`);

	const lines: string[] = [
		"# Catalog sync report",
		"",
		`Generated ${summary.generatedAt} from ${summary.existenceSources.map((s) => s.key).join(", ")} (existence) + ${summary.enrichmentSources.join(", ")} (enrichment).`,
		"",
		"Nothing has been written to any catalog.json — apply what you agree with by hand.",
		"",
		`- ${summary.newEntries.length} new model(s) drafted`,
		`- ${summary.updatedEntries.length} existing model(s) with stale essentials`,
		`- ${summary.deprecations.length} model(s) no longer listed upstream (deprecation candidates)`,
		`- ${summary.conflicts.length} numeric conflict(s) between sources, needs a human`,
		`- ${summary.lowConfidence.length} single-source candidate(s), listed for awareness only`,
		"",
	];
	if (summary.newEntries.length > 0) {
		lines.push(
			"## New models (drafted entries)",
			"",
			"Review each draft against the provider's docs, fill in `operations` details, then paste it into",
			"the adapter's catalog.json. Drafts carrying `needsHumanReview` paths keep `catalog:validate`",
			"failing until you verify the field and clear the marker.",
			"",
		);
		for (const item of summary.newEntries) {
			lines.push(
				`### \`${item.adapterKey}/${item.upstreamModel}\``,
				"",
				"```json",
				JSON.stringify(item.entry, null, "\t"),
				"```",
				"",
			);
		}
	}
	if (summary.updatedEntries.length > 0) {
		lines.push(
			"## Stale essentials (edit by hand)",
			"",
			...summary.updatedEntries.map(
				(item) =>
					`- \`${item.adapterKey}/${item.upstreamModel}\`: ${item.changes.join("; ")}`,
			),
			"",
		);
	}
	if (summary.needsHumanReview.length > 0) {
		lines.push(
			"## ⚠️ Drafted fields needing verification",
			"",
			...summary.needsHumanReview.map(
				(item) =>
					`- \`${item.adapterKey}/${item.upstreamModel}\`: ${item.paths.join(", ")}`,
			),
			"",
		);
	}
	if (summary.conflicts.length > 0) {
		lines.push(
			"## Numeric conflicts (sources disagree)",
			"",
			...summary.conflicts.map(
				(item) =>
					`- \`${item.adapterKey}/${item.upstreamModel}\`: ${item.conflicts
						.map((c) => `${c.field} ${JSON.stringify(c.values)}`)
						.join("; ")}`,
			),
			"",
		);
	}
	if (summary.deprecations.length > 0) {
		lines.push(
			"## No longer listed upstream",
			"",
			...summary.deprecations.map(
				(item) =>
					`- \`${item.adapterKey}/${item.upstreamModel}\`: ${item.reason}`,
			),
			"",
		);
	}
	writeFileSync(new URL("REPORT.md", dir), lines.join("\n"));
	console.log(`wrote ${new URL("REPORT.md", dir).pathname}`);
}

await run();
