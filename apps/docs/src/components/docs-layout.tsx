import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { getBaseOptions } from "#/lib/layout.tsx";
import type { Locale } from "#/lib/i18n.ts";
import { source } from "#/lib/source.ts";

/**
 * The sidebar is the page tree built from `content/docs`, so adding a page is adding a file and
 * listing it in that folder's `meta.json` — there is no navigation to maintain in code.
 */
export default function DocumentationLayout({
	children,
	locale,
}: {
	children: React.ReactNode;
	locale: Locale;
}) {
	return (
		<DocsLayout
			{...getBaseOptions(locale)}
			containerProps={{
				style: { "--fd-layout-width": "100%" } as React.CSSProperties,
			}}
			tree={source.getPageTree(locale)}
		>
			{children}
		</DocsLayout>
	);
}
