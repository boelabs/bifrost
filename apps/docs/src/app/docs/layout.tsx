import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "#/lib/layout.tsx";
import { source } from "#/lib/source.ts";

/**
 * The sidebar is the page tree built from `content/docs`, so adding a page is adding a file and
 * listing it in that folder's `meta.json` — there is no navigation to maintain in code.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<DocsLayout {...baseOptions} tree={source.pageTree}>
			{children}
		</DocsLayout>
	);
}
