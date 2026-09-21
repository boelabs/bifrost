import { createSearchAPI } from "fumadocs-core/search/server";
import { notFound } from "next/navigation";
import { source } from "#/lib/source.ts";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
	return [{ locale: "en" }, { locale: "es" }];
}

export async function GET(
	_request: Request,
	{ params }: RouteContext<"/api/search/[locale]">,
) {
	const { locale } = await params;
	if (locale !== "en" && locale !== "es") {
		notFound();
	}
	return createSearchAPI("advanced", {
		indexes: source.getPages(locale).map((page) => ({
			id: page.url,
			url: page.url,
			title: page.data.title,
			description: page.data.description,
			structuredData: page.data.structuredData,
		})),
	}).staticGET();
}
