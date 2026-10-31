"use client";

import { useSession } from "#/features/auth/session.tsx";
import { usePathname } from "next/navigation";
import { PinnedPages } from "./RecentPages";
import type { ReactNode } from "react";
import { Fragment } from "react";
import Link from "next/link";

import {
	visibleNavigation,
	type NavGroup,
	type NavItem,
	NAVIGATION,
	isActive,
	NAV_ROW,
} from "./navigation.ts";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
	// Suspends here, inside the shell's own boundary, until the gateway answers with the identity.
	const { can } = useSession();
	const pathname = usePathname();
	return (
		<NavGroups
			groups={visibleNavigation(can)}
			onNavigate={onNavigate}
			pathname={pathname}
			pinned={<PinnedPages onNavigate={onNavigate} />}
		/>
	);
}

/**
 * What the sidebar shows while the operator's role is read. The pages and their names are known
 * before the gateway answers, so they are drawn as they are rather than as placeholders; the
 * entries the role cannot use go once it is known. It is part of the prerendered shell, which has
 * no pathname, so the page open is marked once the role arrives with it.
 */
export function SidebarNavFallback({
	onNavigate,
}: {
	onNavigate?: () => void;
}) {
	return (
		<NavGroups groups={NAVIGATION} onNavigate={onNavigate} pathname={null} />
	);
}

function NavGroups({
	groups,
	pathname,
	pinned,
	onNavigate,
}: {
	groups: NavGroup[];
	/** The page open, or `null` when it is not known yet. */
	pathname: string | null;
	/** Like Stripe's shortcuts: right below the main pages, never past the fold. */
	pinned?: ReactNode;
	onNavigate?: (() => void) | undefined;
}) {
	return groups.map((group, index) => (
		<Fragment key={group.label ?? "main"}>
			<div className="flex flex-col gap-0.5">
				{group.label ? (
					<p className="px-2 pb-1 font-medium text-muted-foreground text-xs">
						{group.label}
					</p>
				) : null}
				{group.items.map((item) => (
					<NavLink
						current={pathname !== null && isActive(item, pathname)}
						item={item}
						key={item.href}
						onNavigate={onNavigate}
					/>
				))}
			</div>
			{index === 0 ? pinned : null}
		</Fragment>
	));
}

/** Sidebar entry; active on its own path and on any record or creation page nested under it. */
function NavLink({
	item,
	current,
	onNavigate,
}: {
	item: NavItem;
	current: boolean;
	onNavigate?: (() => void) | undefined;
}) {
	const Icon = item.icon;
	return (
		<Link
			aria-current={current ? "page" : undefined}
			className={NAV_ROW}
			href={item.href}
			onClick={onNavigate}
		>
			<Icon aria-hidden="true" />
			<span className="min-w-0 truncate">{item.label}</span>
		</Link>
	);
}
