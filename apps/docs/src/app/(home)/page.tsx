import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	// Absolute: the root layout's "%s · Bifrost" template would render "Bifrost · Bifrost" here.
	title: { absolute: "Bifrost" },
	description:
		"An AI gateway by Boelabs. Connect your providers through familiar APIs while you control routing, access, and costs.",
};

/**
 * The landing page.
 *
 * It was a Starlight `template: splash` page with a `hero:` frontmatter block and a slab of raw
 * HTML; as a real component the three paths below can share the type scale and colour tokens with
 * the rest of the site instead of carrying their own stylesheet.
 */
const PATHS = [
	{
		title: "Connect your application",
		description:
			"Use a virtual key and a public model name with OpenAI or Anthropic-compatible endpoints.",
		action: "Make your first request",
		href: "/docs/quickstart",
	},
	{
		title: "Choose your providers",
		description:
			"Route requests across deployments, with explicit model capabilities and fallback policies.",
		action: "Browse provider guides",
		href: "/docs/providers",
	},
	{
		title: "Run it yourself",
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

export default function HomePage() {
	return (
		<main className="flex flex-1 flex-col">
			<section className="dot-grid border-fd-border border-b">
				<div className="mx-auto w-full max-w-5xl px-4 py-24 sm:py-32">
					<h1 className="font-semibold text-5xl tracking-tight sm:text-6xl">
						Bifrost
					</h1>
					<p className="mt-5 max-w-2xl text-balance text-fd-muted-foreground text-lg">
						An AI gateway by Boelabs. Connect your providers through familiar
						APIs while you control routing, access, and costs.
					</p>
					<div className="mt-8 flex flex-wrap items-center gap-3">
						<Link
							className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground text-sm transition-opacity hover:opacity-90"
							href="/docs/quickstart"
						>
							Get started
							<ArrowRight aria-hidden className="size-4" />
						</Link>
						<Link
							className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-5 py-2.5 font-medium text-sm transition-colors hover:bg-fd-accent"
							href="/docs/api-overview"
						>
							Explore the API
						</Link>
					</div>
				</div>
			</section>

			<section className="mx-auto grid w-full max-w-5xl gap-8 border-fd-border border-b px-4 py-12 sm:grid-cols-3">
				{PATHS.map((path) => (
					<div className="flex min-w-0 flex-col" key={path.href}>
						<h2 className="font-medium text-lg">{path.title}</h2>
						<p className="mt-2 text-fd-muted-foreground text-sm">
							{path.description}
						</p>
						<Link
							className="mt-4 inline-flex items-center gap-1.5 font-medium text-fd-primary text-sm hover:underline"
							href={path.href}
						>
							{path.action}
							<ArrowRight aria-hidden className="size-3.5" />
						</Link>
					</div>
				))}
			</section>

			<section className="mx-auto w-full max-w-5xl px-4 py-12">
				<h2 className="font-medium text-xl">A familiar request</h2>
				<p className="mt-2 max-w-2xl text-fd-muted-foreground text-sm">
					Point your client at Bifrost. The public model{" "}
					<code className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-xs">
						general
					</code>{" "}
					resolves to deployments you configure.
				</p>
				<div className="mt-5">
					<DynamicCodeBlock code={REQUEST} lang="bash" />
				</div>
				<p className="mt-6 text-sm">
					<Link className="text-fd-primary hover:underline" href="/docs">
						Read the documentation
					</Link>{" "}
					<span className="text-fd-muted-foreground">
						for setup, API contracts, routing, and operations.
					</span>
				</p>
			</section>
		</main>
	);
}
