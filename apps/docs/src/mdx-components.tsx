import defaultComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

/**
 * The component map every MDX page renders through.
 *
 * Fumadocs' defaults already cover what this documentation uses — headings with anchors, tables,
 * code blocks with copy buttons, callouts. Anything added here becomes available to all 61 pages
 * without an import in the MDX itself.
 */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
	return { ...defaultComponents, ...components };
}
