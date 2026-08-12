/**
 * Regenerates apps/gateway/openapi.yaml from the Zod component schemas (src/openapi). Run via
 * `bun run openapi:generate`. The openapi.test.ts drift guard fails CI if the committed file is stale.
 */

import { buildOpenApiDocument } from "#openapi/document.ts";
import { writeFileSync } from "node:fs";
import { stringify } from "yaml";

const outUrl = new URL("../openapi.yaml", import.meta.url);
const banner =
	"# GENERATED FILE - do not edit by hand.\n" +
	"# Source: src/openapi/*.ts. Regenerate with `bun run openapi:generate`.\n";
const yaml = stringify(buildOpenApiDocument(), { lineWidth: 0 });

writeFileSync(outUrl, banner + yaml);
console.log(`Wrote ${outUrl.pathname}`);
