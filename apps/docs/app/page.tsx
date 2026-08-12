import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/app/layout.config";
import Link from "next/link";

import {
	ShieldCheck,
	BookOpen,
	Network,
	Braces,
	Boxes,
	Route,
} from "lucide-react";

const proofItems = [
	{
		title: "Exact client contract",
		description:
			"Chat, responses, messages, images, embeddings, and audio keep the OpenAI shape.",
	},
	{
		title: "Provider-aware routing",
		description:
			"Deployments, allowed models, operation profiles, and fallback chains stay server-owned.",
	},
	{
		title: "OSS operator surface",
		description:
			"Docs, OpenAPI, schemas, and guarded tests ship with the repo.",
	},
];

const features = [
	{
		icon: Route,
		title: "One public model namespace",
		description:
			"Clients call public model names while Bifrost resolves provider deployments and upstream ids.",
	},
	{
		icon: Network,
		title: "Fallbacks with reasons",
		description:
			"Chains carry retry semantics, lifecycle state, and operator-readable reasons for every hop.",
	},
	{
		icon: Braces,
		title: "Catalog-backed capabilities",
		description:
			"Model profiles describe operations, formats, pricing, limits, reasoning, and custom metadata.",
	},
];

export default function Home() {
	return (
		<HomeLayout {...baseOptions} className="unified-home">
			<section className="unified-hero unified-shell">
				<div className="unified-hero-copy">
					<h1>Bifrost</h1>
					<p className="unified-lede">
						A provider-agnostic AI gateway for routing public models across
						adapters, fallback policies, runtime extensions, and exact
						OpenAI-shaped responses.
					</p>
					<div className="unified-actions">
						<Link
							className="unified-button unified-button-primary"
							href="/docs"
						>
							<BookOpen aria-hidden="true" />
							Open docs
						</Link>
						<Link
							className="unified-button unified-button-secondary"
							href="/docs/api"
						>
							<Boxes aria-hidden="true" />
							API reference
						</Link>
					</div>
					<div className="unified-proof">
						{proofItems.map((item) => (
							<div className="unified-proof-item" key={item.title}>
								<strong>{item.title}</strong>
								<span>{item.description}</span>
							</div>
						))}
					</div>
				</div>

				<aside className="unified-console" aria-label="Gateway route preview">
					<div className="unified-console-top">
						<span className="unified-console-status">Live route</span>
						<span>/v1/responses</span>
					</div>
					<div className="unified-console-body">
						<div className="unified-route" data-active="true">
							<div className="unified-label">Client request</div>
							<div className="unified-value">
								model: "boelabs/boberth-medium-0626"
							</div>
						</div>
						<div className="unified-route">
							<div className="unified-label">Gateway policy</div>
							<div className="unified-value">
								publicModel -&gt; allowedModels -&gt; fallback_policies
							</div>
						</div>
						<div className="unified-provider-grid">
							<div className="unified-provider">
								<span>Adapter</span>
								<strong>OpenAI</strong>
							</div>
							<div className="unified-provider">
								<span>Adapter</span>
								<strong>Anthropic</strong>
							</div>
							<div className="unified-provider">
								<span>Adapter</span>
								<strong>Google AI</strong>
							</div>
							<div className="unified-provider">
								<span>Adapter</span>
								<strong>Azure</strong>
							</div>
						</div>
						<div className="unified-route">
							<div className="unified-label">Canonical response</div>
							<div className="unified-value">
								OpenAI-compatible payload returned to the client.
							</div>
						</div>
					</div>
				</aside>
			</section>

			<section className="unified-band">
				<div className="unified-shell">
					<div className="unified-section-heading">
						<h2>Documentation that starts at the gateway, not a theme demo.</h2>
						<p>
							The Fumadocs build keeps the docs tree fast and searchable while
							the home stays product-specific: routing, contracts, fallbacks,
							catalog metadata, and runtime extension points.
						</p>
					</div>
					<div className="unified-feature-grid">
						{features.map((feature) => {
							const Icon = feature.icon;

							return (
								<article className="unified-feature" key={feature.title}>
									<Icon aria-hidden="true" />
									<h3>{feature.title}</h3>
									<p>{feature.description}</p>
								</article>
							);
						})}
						<article className="unified-feature">
							<ShieldCheck aria-hidden="true" />
							<h3>Network-safe tests</h3>
							<p>
								The test harness blocks real provider traffic unless an operator
								explicitly opts in.
							</p>
						</article>
					</div>
				</div>
			</section>
		</HomeLayout>
	);
}
