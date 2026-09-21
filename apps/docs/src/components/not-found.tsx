import { localizedPath, type Locale } from "#/lib/i18n.ts";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { getHomeOptions } from "#/lib/layout.tsx";
import Link from "next/link";

/** Keeps the header and the theme on a wrong address, so the way out is one click rather than Back. */
export default function NotFound({ locale }: { locale: Locale }) {
	return (
		<HomeLayout {...getHomeOptions(locale)}>
			<main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
				<p className="font-mono text-fd-muted-foreground text-sm">404</p>
				<h1 className="font-semibold text-3xl">
					{locale === "es" ? "Página no encontrada" : "Page not found"}
				</h1>
				<p className="text-fd-muted-foreground">
					{locale === "es"
						? "La página pudo cambiar de ubicación o la dirección es incorrecta."
						: "The page may have moved, or the address may be incorrect."}
				</p>
				<Link
					className="mt-2 rounded-lg bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground text-sm"
					href={localizedPath("/docs", locale)}
				>
					{locale === "es"
						? "Ver la documentación"
						: "Browse the documentation"}
				</Link>
			</main>
		</HomeLayout>
	);
}
