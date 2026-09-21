"use client";

import { localizedPath, spanishUI, type Locale } from "#/lib/i18n.ts";
import { RootProvider } from "fumadocs-ui/provider/next";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";

const Search = dynamic(() => import("./search.tsx"));

export function Provider({
	children,
	locale,
}: {
	children: ReactNode;
	locale: Locale;
}) {
	const pathname = usePathname();
	const router = useRouter();
	return (
		<RootProvider
			i18n={{
				locale,
				locales: [
					{ locale: "en", name: "English" },
					{ locale: "es", name: "Español" },
				],
				translations: locale === "es" ? spanishUI : {},
				onLocaleChange(value) {
					if (value === "en" || value === "es") {
						router.push(
							localizedPath(pathname, value) +
								window.location.search +
								window.location.hash,
						);
					}
				},
			}}
			search={{ SearchDialog: Search }}
		>
			{children}
		</RootProvider>
	);
}
