import { getMDXComponents } from "#/mdx-components.tsx";
import type { Locale } from "#/lib/i18n.ts";
import { notFound } from "next/navigation";
import { source } from "#/lib/source.ts";
import type { Metadata } from "next";

import {
	DocsDescription,
	DocsTitle,
	DocsBody,
	DocsPage,
} from "fumadocs-ui/page";

/**
 * Every documentation page.
 *
 * The optional catch-all covers `/docs` (the overview, `content/docs/index.mdx`) and every page
 * below it from the one file. `generateStaticParams` hands Next the full list at build time, so the
 * site is prerendered in its entirety and the running server never renders MDX.
 */
export default function DocumentationPage({
	slug,
	locale,
}: {
	slug: string[] | undefined;
	locale: Locale;
}) {
	const page = source.getPage(slug, locale);
	if (!page) {
		notFound();
	}

	const MDX = page.data.body;
	return (
		<DocsPage
			className="mx-auto w-full max-w-4xl"
			full={page.data.full}
			toc={page.data.toc}
		>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription>{page.data.description}</DocsDescription>
			<DocsBody>
				<MDX components={getMDXComponents()} />
			</DocsBody>
		</DocsPage>
	);
}

export function pageMetadata(
	slug: string[] | undefined,
	locale: Locale,
): Metadata {
	const page = source.getPage(slug, locale);
	if (!page) {
		notFound();
	}
	return { title: page.data.title, description: page.data.description };
}
