import { getMDXComponents } from "#/mdx-components.tsx";
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
export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) {
		notFound();
	}

	const MDX = page.data.body;
	return (
		<DocsPage full={page.data.full} toc={page.data.toc}>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription>{page.data.description}</DocsDescription>
			<DocsBody>
				<MDX components={getMDXComponents()} />
			</DocsBody>
		</DocsPage>
	);
}

export function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata(
	props: PageProps<"/docs/[[...slug]]">,
): Promise<Metadata> {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) {
		notFound();
	}
	return { title: page.data.title, description: page.data.description };
}
