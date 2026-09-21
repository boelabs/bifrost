import { Steps, Step } from "fumadocs-ui/components/steps";
import { Cards, Card } from "fumadocs-ui/components/card";
import { Tabs, Tab } from "fumadocs-ui/components/tabs";
import defaultComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

/**
 * The component map every MDX page renders through.
 *
 * Fumadocs' defaults already cover what this documentation uses — headings with anchors, tables,
 * code blocks with copy buttons, callouts. Anything added here becomes available to every page
 * without an import in the MDX itself.
 */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
	return {
		...defaultComponents,
		Cards,
		Card,
		Steps,
		Step,
		Tabs,
		Tab,
		...components,
	};
}
