"use client";

import { ArrowUpRightIcon, BookOpenIcon } from "lucide-react";
import { createContext, use } from "react";
import { NAV_ROW } from "./navigation.ts";

/**
 * This deployment's documentation site (`DOCS_URL`), or `null` without one. A promise, like the
 * identity: the layout reads the environment per request without awaiting it, so the shell stays
 * prerendered and only what shows the link waits for it.
 */
const DocsContext = createContext<Promise<string | null>>(
	Promise.resolve(null),
);

export function DocsProvider({
	docs,
	children,
}: {
	docs: Promise<string | null>;
	children: React.ReactNode;
}) {
	return <DocsContext value={docs}>{children}</DocsContext>;
}

export function useDocsUrl(): string | null {
	return use(use(DocsContext));
}

/**
 * The sidebar foot's *Documentation*, Billete's: it leaves the dashboard, so it opens in a new tab
 * with a quiet ↗. Nothing at all when the deployment has no docs site.
 */
export function DocsLink({ onNavigate }: { onNavigate?: () => void }) {
	const href = useDocsUrl();
	if (!href) {
		return null;
	}
	return (
		<a
			className={NAV_ROW}
			href={href}
			onClick={onNavigate}
			rel="noreferrer"
			target="_blank"
		>
			<BookOpenIcon aria-hidden="true" />
			<span className="min-w-0 flex-1 truncate">Documentation</span>
			<ArrowUpRightIcon aria-hidden="true" className="text-muted-foreground" />
			<span className="sr-only">(opens in a new tab)</span>
		</a>
	);
}
