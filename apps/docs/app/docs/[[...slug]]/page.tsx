import defaultMdxComponents, { createRelativeLink } from "fumadocs-ui/mdx";
import { notFound } from "next/navigation";
import { source } from "@/lib/source";
import type { Metadata } from "next";

import {
	DocsDescription,
	DocsTitle,
	DocsBody,
	DocsPage,
} from "fumadocs-ui/layouts/docs/page";

type PageProps = {
	params: Promise<{
		slug?: string[];
	}>;
};

export default async function Page(props: PageProps) {
	const params = await props.params;
	const page = source.getPage(params.slug);

	if (!page) {
		notFound();
	}

	const MDXContent = page.data.body;

	return (
		<DocsPage toc={page.data.toc}>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription>{page.data.description}</DocsDescription>
			<DocsBody>
				<MDXContent
					components={{
						...defaultMdxComponents,
						a: createRelativeLink(source, page),
					}}
				/>
			</DocsBody>
		</DocsPage>
	);
}

export function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
	const params = await props.params;
	const page = source.getPage(params.slug);

	if (!page) {
		notFound();
	}

	return {
		title: page.data.title,
		description: page.data.description,
	};
}
