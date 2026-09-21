import { createFromSource } from "fumadocs-core/search/server";
import { source } from "#/lib/source.ts";

// Export the index at build time; queries run in the browser when search is opened.
export const dynamic = "force-static";
export const { staticGET: GET } = createFromSource(source);
