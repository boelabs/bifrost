import { withStubbedFetch } from "#test-support/fetch.ts";
import type { CatalogEntry } from "#catalog/types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	compareAzureListing,
	parseAzureListing,
	checkAzureListing,
	AZURE_LISTING_URL,
} from "./azureListing.ts";

// Trimmed from the Learn page's Markdown rendering, keeping each row shape the parser has to handle.
const page = [
	"## Intro, outside any tab",
	"| `outside-zone` | ignored |",
	'::: zone pivot="azure-openai"',
	"## Azure OpenAI in Microsoft Foundry models",
	"| Models | Description |",
	"| --- | --- |",
	"| [GPT-5 series](models#gpt-5) | `gpt-5`, `gpt-5-mini` |",
	"| [`Video generation`](models#video) | A model. |",
	"## GPT-5",
	"| Model ID | Description |",
	"| --- | --- |",
	"| `gpt-5` (2025-08-07) | Reasoning. |",
	"| `gpt-5-chat` (2025-08-07)**Retired June 29, 2026** | Historical. |",
	"| `gpt-5-chat` (2025-10-03)**Retired May 13, 2026** | Historical. |",
	"| `gpt-5.3-chat` (2026-03-03)**Retired June 29, 2026** | Historical. |",
	"| `gpt-chat-latest` (2026-10-07)**Preview** | Reasoning. |",
	"## Audio models",
	"| `gpt-audio`(2025-08-28)`gpt-audio-mini`(2025-10-06) | Audio. |",
	"## Fine-tuning models",
	"| `Qwen3-32B` | Managed: ✅ |",
	"::: zone-end",
	'::: zone pivot="azure-direct-others"',
	"## SpaceXAI models sold by Azure",
	"| `grok-4.7` | Chat Completions API |",
	"| `grok-4-20-reasoning`**Preview** | chat-completion |",
	"## Microsoft models sold by Azure",
	"| [`Microsoft-Decision-1`](https://ai.azure.com/x) | decision |",
	"::: zone-end",
].join("\n");

const entry = (deprecated?: true): CatalogEntry => ({
	operations: {},
	...(deprecated ? { deprecated } : {}),
});

test("parseAzureListing: ids per tab, from first cells only, outside fine-tuning", () => {
	const listed = parseAzureListing(page);
	assert.deepEqual(
		listed.map((m) => `${m.adapterKey}/${m.id}${m.retired ? " retired" : ""}`),
		[
			"azureopenai/gpt-5",
			"azureopenai/gpt-5-chat retired",
			"azureopenai/gpt-5.3-chat retired",
			"azureopenai/gpt-chat-latest",
			"azureopenai/gpt-audio",
			"azureopenai/gpt-audio-mini",
			"azurefoundry/grok-4.7",
			"azurefoundry/grok-4-20-reasoning",
			"azurefoundry/Microsoft-Decision-1",
		],
	);
	assert.equal(listed[0]?.section, "GPT-5");
});

test("parseAzureListing: an id is retired only when every row listing it says so", () => {
	const listed = parseAzureListing(
		[
			'::: zone pivot="azure-openai"',
			"## Speech",
			"| `gpt-4o-mini-transcribe` (2025-03-20)**Retired** | Old. |",
			"| `gpt-4o-mini-transcribe` (2025-12-15) | Current. |",
			"::: zone-end",
		].join("\n"),
	);
	assert.deepEqual(listed, [
		{
			adapterKey: "azureopenai",
			id: "gpt-4o-mini-transcribe",
			section: "Speech",
			retired: false,
		},
	]);
});

test("compareAzureListing: reports missing ids and retired ids still served, skips unserved ones", () => {
	const catalogs = new Map<string, Record<string, CatalogEntry>>([
		[
			"azureopenai",
			{
				"gpt-5": entry(),
				"gpt-5-chat": entry(true),
				"gpt-5.3-chat": entry(),
			},
		],
		["azurefoundry", { "grok-4.20-reasoning": entry() }],
	]);
	const findings = compareAzureListing(parseAzureListing(page), catalogs, {
		azureopenai: { "gpt-audio": "No audio chat operation." },
		azurefoundry: {},
	});
	assert.equal(findings.complete, true);
	assert.deepEqual(
		findings.missing.map((m) => `${m.adapterKey}/${m.id}`),
		[
			"azureopenai/gpt-chat-latest",
			"azureopenai/gpt-audio-mini",
			"azurefoundry/grok-4.7",
			"azurefoundry/Microsoft-Decision-1",
		],
	);
	assert.deepEqual(
		findings.retiredNotDeprecated.map((m) => `${m.adapterKey}/${m.id}`),
		["azureopenai/gpt-5.3-chat"],
	);
});

test("checkAzureListing: asks Learn for Markdown and compares it", async () => {
	let requested: Request | undefined;
	const findings = await withStubbedFetch(
		(input, init) => {
			requested = new Request(input, init);
			return new Response(page, {
				headers: { "content-type": "text/markdown" },
			});
		},
		() => checkAzureListing(new Map()),
	);
	assert.equal(requested?.url, AZURE_LISTING_URL);
	assert.equal(requested?.headers.get("accept"), "text/markdown");
	assert.equal(findings.complete, true);
	assert.ok(findings.missing.some((m) => m.id === "grok-4.7"));
});

test("checkAzureListing: a page missing a tab is incomplete, never 'nothing new'", async () => {
	const findings = await withStubbedFetch(
		() => new Response("<html>moved</html>"),
		() => checkAzureListing(new Map()),
	);
	assert.equal(findings.complete, false);
	assert.match(findings.error ?? "", /azureopenai, azurefoundry/);
	assert.deepEqual(findings.missing, []);
});

test("checkAzureListing: a failed fetch is incomplete", async () => {
	const findings = await withStubbedFetch(
		() => new Response("gone", { status: 404 }),
		() => checkAzureListing(new Map()),
	);
	assert.equal(findings.complete, false);
	assert.match(findings.error ?? "", /status 404/);
});
