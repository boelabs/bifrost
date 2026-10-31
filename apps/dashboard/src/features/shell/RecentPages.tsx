"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSession } from "#/features/auth/session.tsx";
import { PinIcon, PinOffIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import { usePathname } from "next/navigation";
import { cn } from "#/shared/lib/classes";
import { NAV_ROW } from "./navigation.ts";
import Link from "next/link";

import {
	subscribeRecent,
	isRecordPath,
	updateRecent,
	parseRecent,
	recordVisit,
	readRecent,
	recentKey,
	togglePin,
	isPinned,
	areaOf,
} from "./recents.ts";

/**
 * This browser's remembered records for the operator signed in. Read only after hydration: the
 * server has no storage, so it starts empty.
 */
export function useRecentPages() {
	const { identity } = useSession();
	const key = recentKey(identity.user.id);
	const raw = useSyncExternalStore(
		subscribeRecent,
		() => readRecent(key),
		() => null,
	);
	const pages = useMemo(() => parseRecent(raw), [raw]);
	return { key, pages };
}

/** Remembers the record open now under its name, for *Recent*. Rendered by the breadcrumbs. */
export function RememberVisit({ title }: { title: string }) {
	const pathname = usePathname();
	const { key } = useRecentPages();
	useEffect(() => {
		if (isRecordPath(pathname)) {
			updateRecent(key, (pages) =>
				recordVisit(pages, { href: pathname, title }),
			);
		}
	}, [key, pathname, title]);
	return null;
}

/** Pins the record open now to the sidebar's *Pinned*, or takes it out. */
export function PinToggle({ title }: { title: string }) {
	const pathname = usePathname();
	const { key, pages } = useRecentPages();
	if (!isRecordPath(pathname)) {
		return null;
	}
	const pinned = isPinned(pages, pathname);
	const label = pinned ? "Unpin" : "Pin to sidebar";
	return (
		<Button
			aria-label={label}
			aria-pressed={pinned}
			className="-my-1 text-muted-foreground"
			mode="icon"
			onClick={() =>
				updateRecent(key, (current) =>
					togglePin(current, { href: pathname, title }),
				)
			}
			size="xs"
			title={label}
			variant="ghost"
		>
			<PinIcon
				aria-hidden="true"
				className={pinned ? "fill-current" : undefined}
			/>
		</Button>
	);
}

/**
 * The sidebar's *Pinned*: the records the operator pinned, in the order they pinned them. Nothing
 * at all until there is one.
 */
export function PinnedPages({ onNavigate }: { onNavigate?: () => void }) {
	const pathname = usePathname();
	const { key, pages } = useRecentPages();
	const pinned = pages.filter((page) => page.pinned);
	if (pinned.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-0.5">
			<p className="px-2 pb-1 font-medium text-muted-foreground text-xs">
				Pinned
			</p>
			{pinned.map((page) => (
				<div className="group/pinned relative" key={page.href}>
					<Link
						aria-current={pathname === page.href ? "page" : undefined}
						className={cn(NAV_ROW, "pointer-coarse:pe-9")}
						href={page.href}
						onClick={onNavigate}
					>
						<span className="min-w-0 flex-1 truncate">{page.title}</span>
						<span className="pointer-coarse:hidden shrink-0 text-muted-foreground/72 text-xs group-focus-within/pinned:opacity-0 group-hover/pinned:opacity-0">
							{areaOf(page.href)}
						</span>
					</Link>
					<Button
						aria-label={`Unpin ${page.title}`}
						className="absolute end-1 top-1/2 -translate-y-1/2 text-muted-foreground opacity-0 pointer-coarse:opacity-100 group-focus-within/pinned:opacity-100 group-hover/pinned:opacity-100"
						mode="icon"
						onClick={() =>
							updateRecent(key, (current) => togglePin(current, page))
						}
						size="xs"
						title="Unpin"
						variant="ghost"
					>
						<PinOffIcon aria-hidden="true" />
					</Button>
				</div>
			))}
		</div>
	);
}
