import { createFromSource } from "fumadocs-core/search/server";
import { source } from "#/lib/source.ts";

/**
 * The search index, queried in process.
 *
 * This is the only route the running server actually computes — everything else is prerendered. The
 * index is built from the same page tree the sidebar uses, so a page cannot be searchable and
 * missing from the navigation, or the reverse.
 */
export const { GET } = createFromSource(source);
