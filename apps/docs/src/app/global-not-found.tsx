import Document from "#/components/document.tsx";
import Link from "next/link";

export const metadata = { title: "404 · Bifrost" };

export default function GlobalNotFound() {
	return (
		<Document locale="en">
			<main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
				<p className="font-mono text-fd-muted-foreground">404 · Bifrost</p>
				<section lang="en">
					<h1 className="font-semibold text-2xl">Page not found</h1>
					<p className="mt-2 text-fd-muted-foreground">
						The page may have moved, or the address may be incorrect.
					</p>
					<Link className="mt-4 inline-block underline" href="/docs">
						Browse the documentation
					</Link>
				</section>
				<section lang="es">
					<h2 className="font-semibold text-2xl">Página no encontrada</h2>
					<p className="mt-2 text-fd-muted-foreground">
						La página pudo cambiar de ubicación o la dirección es incorrecta.
					</p>
					<Link className="mt-4 inline-block underline" href="/es/docs">
						Ver la documentación
					</Link>
				</section>
			</main>
		</Document>
	);
}
