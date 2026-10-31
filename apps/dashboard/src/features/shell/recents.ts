import { browserStore, parseStored } from "#/shared/lib/browserStore.ts";
import { NAVIGATION } from "./navigation.ts";

/**
 * The records an operator opened lately and those they pinned: the command palette's *Recent* and
 * the sidebar's *Pinned*. A convenience of this browser only (`browserStore`): nothing depends on
 * it.
 */
export interface RecentPage {
	href: string;
	title: string;
	pinned: boolean;
}

/** How many of the latest are kept, besides the pinned ones. */
export const RECENT_LIMIT = 6;

/**
 * Per operator: two people sharing a browser never see each other's records. The operator signed
 * in with the master key has no user, so no id.
 */
export function recentKey(userId: string | null) {
	return `bifrozz:recent:${userId ?? "root"}`;
}

/** A record's page (`/models/<id>`, `/logs/<id>`), not a form to create one. */
export function isRecordPath(pathname: string) {
	return /^\/[^/]+\/[^/]/.test(pathname) && !pathname.endsWith("/new");
}

/**
 * What was stored, keeping only well-formed entries for dashboard pages: whatever else is in
 * storage never becomes a link.
 */
export function parseRecent(raw: string | null): RecentPage[] {
	const value = parseStored(raw);
	return (Array.isArray(value) ? value : []).flatMap(
		(entry: unknown): RecentPage[] => {
			if (!entry || typeof entry !== "object") {
				return [];
			}
			const { href, title, pinned } = entry as Record<string, unknown>;
			return typeof href === "string" &&
				isRecordPath(href) &&
				typeof title === "string" &&
				title !== ""
				? [{ href, title, pinned: pinned === true }]
				: [];
		},
	);
}

/**
 * A visit: the page goes first among the latest (with its current title) and the oldest falls off.
 * A pinned page keeps its place, so *Pinned* never reorders by itself.
 */
export function recordVisit(
	pages: RecentPage[],
	visit: { href: string; title: string },
): RecentPage[] {
	if (pages.some((page) => page.href === visit.href && page.pinned)) {
		return pages.map((page) =>
			page.href === visit.href ? { ...page, title: visit.title } : page,
		);
	}
	const recent = pages.filter(
		(page) => !page.pinned && page.href !== visit.href,
	);
	return [
		...pages.filter((page) => page.pinned),
		...[{ ...visit, pinned: false }, ...recent].slice(0, RECENT_LIMIT),
	];
}

/** Pinning adds the page after the pinned ones; unpinning, back to the head of the latest. */
export function togglePin(
	pages: RecentPage[],
	record: { href: string; title: string },
): RecentPage[] {
	const page = pages.find((item) => item.href === record.href) ?? {
		...record,
		pinned: false,
	};
	const others = pages.filter((item) => item.href !== record.href);
	const pinned = others.filter((item) => item.pinned);
	const recent = others.filter((item) => !item.pinned);
	return page.pinned
		? [
				...pinned,
				...[{ ...page, pinned: false }, ...recent].slice(0, RECENT_LIMIT),
			]
		: [...pinned, { ...page, pinned: true }, ...recent];
}

export function isPinned(pages: RecentPage[], href: string) {
	return pages.some((page) => page.href === href && page.pinned);
}

/** The sidebar page a record belongs to (*Models*, *Logs*…), which names its kind. */
export function areaOf(href: string): string | undefined {
	return NAVIGATION.flatMap((group) => group.items)
		.filter((item) => item.href !== "/" && href.startsWith(`${item.href}/`))
		.sort((a, b) => b.href.length - a.href.length)[0]?.label;
}

const store = browserStore("bifrozz:recent-pages", parseRecent);

export const readRecent = store.read;
export const updateRecent = store.update;
export const subscribeRecent = store.subscribe;
