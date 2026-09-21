import DocumentationPage, { pageMetadata } from "#/components/docs-page.tsx";
import { source } from "#/lib/source.ts";

export const dynamicParams = false;
export default async function Page({ params }: PageProps<"/docs/[[...slug]]">) {
	const { slug } = await params;
	return <DocumentationPage locale="en" slug={slug} />;
}
export function generateStaticParams() {
	return source.getPages("en").map((page) => ({ slug: page.slugs }));
}
export async function generateMetadata({
	params,
}: PageProps<"/docs/[[...slug]]">) {
	return pageMetadata((await params).slug, "en");
}
