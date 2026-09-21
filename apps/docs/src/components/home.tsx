import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { localizedPath, type Locale } from "#/lib/i18n.ts";
import { Cards, Card } from "fumadocs-ui/components/card";
import { BookOpen, Network, Server } from "lucide-react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

const PATHS = [
	{
		title: "Connect your application",
		spanishTitle: "Conecta tu aplicación",
		spanishDescription:
			"Usa una virtual key y un public model con endpoints compatibles con OpenAI o Anthropic.",
		icon: BookOpen,
		description:
			"Use a virtual key and a public model name with OpenAI or Anthropic-compatible endpoints.",
		action: "Make your first request",
		href: "/docs/quickstart",
	},
	{
		title: "Choose your providers",
		spanishTitle: "Elige tus proveedores",
		spanishDescription:
			"Distribuye solicitudes entre deployments con capacidades y políticas de fallback definidas.",
		icon: Network,
		description:
			"Route requests across deployments, with explicit model capabilities and fallback policies.",
		action: "Browse provider guides",
		href: "/docs/providers",
	},
	{
		title: "Run it yourself",
		spanishTitle: "Aloja Bifrost",
		spanishDescription:
			"Ejecuta el gateway con Bun, Postgres y Redis. Mantén el control de las credenciales y las políticas.",
		icon: Server,
		description:
			"Deploy the Bun gateway with Postgres and Redis. Keep credentials and policies under your control.",
		action: "Deploy Bifrost",
		href: "/docs/deployment",
	},
];

// The backslashes are escaped: a lone \ before a newline inside a template literal is a JS line
// continuation, which silently collapses the whole command onto one line.
const REQUEST = `curl http://localhost:4000/v1/chat/completions \\
  -H "Authorization: Bearer $BIFROST_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"general","messages":[{"role":"user","content":"Hello"}]}'`;

export default function HomePage({ locale }: { locale: Locale }) {
	return (
		<main className="flex flex-1 flex-col">
			<section className="dot-grid border-fd-border border-b">
				<div className="mx-auto w-full max-w-5xl px-4 py-24 sm:py-32">
					<h1 className="font-semibold text-5xl tracking-tight sm:text-6xl">
						Bifrost
					</h1>
					<p className="mt-5 max-w-2xl text-balance text-fd-muted-foreground text-lg">
						{locale === "es"
							? "Un gateway de inteligencia artificial de Boelabs. Conecta tus proveedores mediante APIs conocidas y controla el routing, el acceso y los costos."
							: "An AI gateway by Boelabs. Connect your providers through familiar APIs while you control routing, access, and costs."}
					</p>
					<div className="mt-8 flex flex-wrap items-center gap-3">
						<Link
							className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground text-sm transition-opacity hover:opacity-90"
							href={localizedPath("/docs/quickstart", locale)}
						>
							{locale === "es" ? "Comenzar" : "Get started"}
							<ArrowRight aria-hidden className="size-4" />
						</Link>
						<Link
							className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-5 py-2.5 font-medium text-sm transition-colors hover:bg-fd-accent"
							href={localizedPath("/docs/api-overview", locale)}
						>
							{locale === "es" ? "Explorar la API" : "Explore the API"}
						</Link>
					</div>
				</div>
			</section>

			<section
				aria-label={
					locale === "es"
						? "Explorar la documentación"
						: "Explore the documentation"
				}
				className="mx-auto w-full max-w-5xl px-4 py-12"
			>
				<Cards className="sm:grid-cols-3">
					{PATHS.map((path) => (
						<Card
							href={localizedPath(path.href, locale)}
							icon={<path.icon aria-hidden />}
							key={path.href}
							title={locale === "es" ? path.spanishTitle : path.title}
						>
							{locale === "es" ? path.spanishDescription : path.description}
						</Card>
					))}
				</Cards>
			</section>

			<section className="mx-auto w-full max-w-5xl px-4 py-12">
				<h2 className="font-medium text-xl">
					{locale === "es" ? "Una solicitud conocida" : "A familiar request"}
				</h2>
				<p className="mt-2 max-w-2xl text-fd-muted-foreground text-sm">
					{locale === "es"
						? "Apunta tu cliente a Bifrost. El public model "
						: "Point your client at Bifrost. The public model "}
					<code className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-xs">
						general
					</code>{" "}
					{locale === "es"
						? "se resuelve a los deployments que configures."
						: "resolves to deployments you configure."}
				</p>
				<div className="mt-5">
					<CodeBlock
						title={locale === "es" ? "Primera solicitud" : "First request"}
					>
						<Pre>
							<code>{REQUEST}</code>
						</Pre>
					</CodeBlock>
				</div>
				<p className="mt-6 text-sm">
					<Link
						className="text-fd-primary hover:underline"
						href={localizedPath("/docs", locale)}
					>
						{locale === "es"
							? "Consulta la documentación"
							: "Read the documentation"}
					</Link>{" "}
					<span className="text-fd-muted-foreground">
						{locale === "es"
							? "para configurar, integrar y operar Bifrost."
							: "for setup, API contracts, routing, and operations."}
					</span>
				</p>
			</section>
		</main>
	);
}
