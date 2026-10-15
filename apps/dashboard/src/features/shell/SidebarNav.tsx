"use client";

import { isActive, type NavItem, visibleNavigation } from "./navigation.ts";
import { useSession } from "#/features/auth/session.tsx";
import { usePathname } from "next/navigation";
import Link from "next/link";

/** A quiet sidebar row; the page open is `bg-primary/10 text-primary` (`aria-current`). */
export const NAV_ROW =
	"flex items-center gap-2 rounded-lg p-2 text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-accent-foreground/80 hover:transition-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary [&_svg]:size-4 [&_svg]:shrink-0";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
	// Suspends here, inside the shell's own boundary, until the gateway answers with the identity.
	const { can } = useSession();
	return (
		<>
			{visibleNavigation(can).map((group) => (
				<div className="flex flex-col gap-0.5" key={group.label ?? "main"}>
					{group.label ? (
						<p className="px-2 pb-1 font-medium text-muted-foreground text-xs">
							{group.label}
						</p>
					) : null}
					{group.items.map((item) => (
						<NavLink item={item} key={item.href} onNavigate={onNavigate} />
					))}
				</div>
			))}
		</>
	);
}

/** Sidebar entry; active on its own path and on any record or creation page nested under it. */
function NavLink({
	item,
	onNavigate,
}: {
	item: NavItem;
	onNavigate?: (() => void) | undefined;
}) {
	const pathname = usePathname();
	const Icon = item.icon;
	return (
		<Link
			aria-current={isActive(item, pathname) ? "page" : undefined}
			className={NAV_ROW}
			href={item.href}
			onClick={onNavigate}
		>
			<Icon aria-hidden="true" />
			<span className="min-w-0 truncate">{item.label}</span>
		</Link>
	);
}
