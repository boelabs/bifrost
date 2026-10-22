import type { CatalogEntry } from "#catalog/types.ts";
import { normalizeTag } from "./providerIdentity.ts";
import { fetchTextWithRetry } from "./fetch.ts";

/**
 * Microsoft's own list of the models Azure sells. Learn serves it as Markdown on `Accept: text/markdown`,
 * with every tab of the page (`::: zone pivot="..."`) in one document. The aggregators the sync trusts
 * for existence never list Azure's deployment ids, so without this page an Azure model only reaches the
 * catalog if someone happens to read it.
 */
export const AZURE_LISTING_URL =
	"https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure";

/** One adapter per tab of the page. */
const PIVOT_ADAPTERS: Readonly<Record<string, string>> = {
	"azure-openai": "azureopenai",
	"azure-direct-others": "azurefoundry",
};

/** Sections that list models for other purposes than inference (fine-tuning bases, Assistants). */
const SKIPPED_SECTION = /^(fine-tuning|assistants)/i;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Listed ids Bifrost deliberately does not carry, with the reason. A listed id that is neither in the
 * adapter's catalog nor here is reported as missing, so deciding not to serve a model is an explicit,
 * reviewed change rather than an oversight.
 */
export const AZURE_LISTING_UNSERVED: Readonly<
	Record<string, Readonly<Record<string, string>>>
> = {
	azureopenai: {
		"computer-use-preview":
			"Built for the Responses computer-use tool, which Bifrost does not expose.",
		"sora-2": "The azureopenai adapter has no video transport.",
		"gpt-4o-audio-preview":
			"Audio output; Bifrost has no audio chat operation.",
		"gpt-4o-mini-audio-preview":
			"Audio output; Bifrost has no audio chat operation.",
		"gpt-audio": "Audio output; Bifrost has no audio chat operation.",
		"gpt-audio-mini": "Audio output; Bifrost has no audio chat operation.",
		"gpt-audio-1.5": "Audio output; Bifrost has no audio chat operation.",
		"gpt-4o-realtime-preview":
			"Realtime API; Bifrost has no realtime operation.",
		"gpt-4o-mini-realtime-preview":
			"Realtime API; Bifrost has no realtime operation.",
		"gpt-realtime": "Realtime API; Bifrost has no realtime operation.",
		"gpt-realtime-mini": "Realtime API; Bifrost has no realtime operation.",
		"gpt-realtime-1.5": "Realtime API; Bifrost has no realtime operation.",
		"gpt-realtime-2": "Realtime API; Bifrost has no realtime operation.",
		"gpt-realtime-2.1": "Realtime API; Bifrost has no realtime operation.",
		"gpt-realtime-2.1-mini": "Realtime API; Bifrost has no realtime operation.",
		"gpt-realtime-translate":
			"Realtime API; Bifrost has no realtime operation.",
		"gpt-realtime-whisper": "Realtime API; Bifrost has no realtime operation.",
		"gpt-live-transcribe": "Realtime API; Bifrost has no realtime operation.",
		tts: "Text to speech; Bifrost has no speech operation.",
		"tts-hd": "Text to speech; Bifrost has no speech operation.",
		"gpt-4o-mini-tts": "Text to speech; Bifrost has no speech operation.",
	},
	azurefoundry: {
		"FLUX.2-flex": "The azurefoundry adapter has no image transport.",
		"FLUX.2-pro": "The azurefoundry adapter has no image transport.",
		"FLUX.1-Kontext-pro": "The azurefoundry adapter has no image transport.",
		"FLUX-1.1-pro": "The azurefoundry adapter has no image transport.",
		"MAI-Image-2.6-Flash": "The azurefoundry adapter has no image transport.",
		"MAI-Image-2.6": "The azurefoundry adapter has no image transport.",
		"MAI-Image-2.5-Pro": "The azurefoundry adapter has no image transport.",
		"MAI-Image-2.5-Flash": "The azurefoundry adapter has no image transport.",
		"MAI-Image-2.5": "The azurefoundry adapter has no image transport.",
		"embed-v-4-0": "The azurefoundry adapter has no embeddings transport.",
		"Cohere-rerank-v4.0-pro":
			"The azurefoundry adapter has no rerank transport.",
		"Cohere-rerank-v4.0-fast":
			"The azurefoundry adapter has no rerank transport.",
		"Cohere-parse-v5": "Document parsing; Bifrost has no OCR operation.",
		"mistral-document-ai-2512":
			"Document parsing; Bifrost has no OCR operation.",
		"mistral-ocr-4-0": "Document parsing; Bifrost has no OCR operation.",
		"Microsoft-Decision-1":
			"Decision scoring; Bifrost has no classification operation.",
	},
};

export interface AzureListedModel {
	adapterKey: string;
	id: string;
	/** The page's `##` heading the model is listed under. */
	section: string;
	/** True when every row that lists this id marks it retired. */
	retired: boolean;
}

/** Every model id in a table row's first cell, per tab, outside the skipped sections. */
export function parseAzureListing(markdown: string): AzureListedModel[] {
	const listed = new Map<string, AzureListedModel>();
	let adapterKey: string | undefined;
	let section = "";
	for (const line of markdown.split("\n")) {
		const pivot = /^::: zone pivot="([^"]+)"/.exec(line);
		if (pivot) {
			adapterKey = PIVOT_ADAPTERS[pivot[1] ?? ""];
			continue;
		}
		if (line.startsWith("::: zone-end")) {
			adapterKey = undefined;
			continue;
		}
		if (line.startsWith("## ")) {
			section = line.slice(3).trim();
			continue;
		}
		if (
			!(adapterKey && line.startsWith("|")) ||
			SKIPPED_SECTION.test(section)
		) {
			continue;
		}
		const firstCell = line.split("|")[1] ?? "";
		const retired = /retired/i.test(firstCell);
		for (const [, id] of firstCell.matchAll(/`([^`]+)`/g)) {
			if (id === undefined || !MODEL_ID.test(id)) {
				continue;
			}
			const key = `${adapterKey}::${id}`;
			const seen = listed.get(key);
			if (seen) {
				seen.retired &&= retired;
			} else {
				listed.set(key, { adapterKey, id, section, retired });
			}
		}
	}
	return [...listed.values()];
}

export interface AzureListingFindings {
	/** False when the page could not be fetched or no longer parses; the lists below are then empty. */
	complete: boolean;
	error?: string;
	/** Listed by Microsoft and not retired, but neither in the adapter's catalog nor in the unserved list. */
	missing: AzureListedModel[];
	/** Marked retired by Microsoft, still served here without `deprecated`. */
	retiredNotDeprecated: AzureListedModel[];
}

export function compareAzureListing(
	listed: readonly AzureListedModel[],
	catalogsByAdapter: ReadonlyMap<string, Record<string, CatalogEntry>>,
	unserved: typeof AZURE_LISTING_UNSERVED = AZURE_LISTING_UNSERVED,
): AzureListingFindings {
	const findings: AzureListingFindings = {
		complete: true,
		missing: [],
		retiredNotDeprecated: [],
	};
	for (const model of listed) {
		const models = catalogsByAdapter.get(model.adapterKey) ?? {};
		const normalized = normalizeTag(model.id);
		const key = Object.keys(models).find((k) => normalizeTag(k) === normalized);
		const entry = key === undefined ? undefined : models[key];
		if (entry) {
			if (model.retired && !entry.deprecated) {
				findings.retiredNotDeprecated.push(model);
			}
			continue;
		}
		if (
			!model.retired &&
			unserved[model.adapterKey]?.[model.id] === undefined
		) {
			findings.missing.push(model);
		}
	}
	return findings;
}

/** Fetches and compares; a page that fails or stops parsing into both tabs is reported, never read as "nothing new". */
export async function checkAzureListing(
	catalogsByAdapter: ReadonlyMap<string, Record<string, CatalogEntry>>,
): Promise<AzureListingFindings> {
	try {
		const markdown = await fetchTextWithRetry(AZURE_LISTING_URL, {
			headers: { accept: "text/markdown" },
		});
		const listed = parseAzureListing(markdown);
		const empty = Object.values(PIVOT_ADAPTERS).filter(
			(adapterKey) => !listed.some((m) => m.adapterKey === adapterKey),
		);
		if (empty.length > 0) {
			throw new Error(`no models parsed for ${empty.join(", ")}`);
		}
		return compareAzureListing(listed, catalogsByAdapter);
	} catch (err) {
		return {
			complete: false,
			error: err instanceof Error ? err.message : String(err),
			missing: [],
			retiredNotDeprecated: [],
		};
	}
}
