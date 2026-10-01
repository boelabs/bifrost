"use client";

import type { Permission } from "#/features/auth/common.ts";
import { useSession } from "#/features/auth/session.tsx";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "cn";

import {
	SlidersHorizontal as IconAdjustmentsHorizontal,
	MessagesSquare as IconMessages,
	ShieldCheck as IconShieldLock,
	ChartColumn as IconChartBar,
	ChartLine as IconChartLine,
	Plug as IconPlugConnected,
	ScrollText as IconLogs,
	Boxes as IconPackages,
	KeyRound as IconKey,
	Users as IconUsers,
} from "lucide-react";

interface NavItem {
	href: string;
	label: string;
	icon: typeof IconPackages;
	/** Every permission listed must be granted for the item to appear. */
	requires: Permission[];
}

/**
 * Navigation is derived from the role, not hardcoded per page: an operator is never shown a section
 * whose API calls would come back 403. The gateway remains the authority — this only avoids dead ends.
 */
const NAV: NavItem[] = [
	{
		href: "/",
		label: "Overview",
		icon: IconChartLine,
		requires: ["usage:read"],
	},
	{
		href: "/metrics",
		label: "Metrics",
		icon: IconChartBar,
		requires: ["usage:read"],
	},
	{
		href: "/models",
		label: "Models",
		icon: IconPackages,
		requires: ["deployments:read"],
	},
	{ href: "/keys", label: "API keys", icon: IconKey, requires: ["keys:read"] },
	{
		href: "/playground",
		label: "Playground",
		icon: IconMessages,
		requires: ["inference:use"],
	},
	{ href: "/logs", label: "Logs", icon: IconLogs, requires: ["logs:read"] },
	{
		href: "/extensions",
		label: "Extensions",
		icon: IconPlugConnected,
		requires: ["settings:read"],
	},
	{
		href: "/settings",
		label: "Settings",
		icon: IconAdjustmentsHorizontal,
		requires: ["settings:read"],
	},
	{
		href: "/users",
		label: "Users",
		icon: IconUsers,
		requires: ["users:manage"],
	},
	{
		href: "/audit",
		label: "Audit",
		icon: IconShieldLock,
		requires: ["audit:read"],
	},
];

export function SidebarNav({
	collapsed,
	onNavigate,
	footer = false,
}: {
	collapsed: boolean;
	onNavigate?: () => void;
	footer?: boolean;
}) {
	// Suspends here, inside the shell's own boundary, until the gateway answers with the identity.
	const { can } = useSession();
	const pathname = usePathname();
	const groups = footer
		? [{ label: null, paths: ["/settings"] }]
		: [
				{ label: null, paths: ["/", "/metrics"] },
				{
					label: "Gateway",
					paths: ["/models", "/keys", "/playground", "/logs"],
				},
				{ label: "Administration", paths: ["/extensions", "/users", "/audit"] },
			];
	return (
		<div className="flex flex-col gap-4">
			{groups.map(({ label: groupLabel, paths }) => {
				const items = NAV.filter(
					(item) => paths.includes(item.href) && can(...item.requires),
				);
				if (items.length === 0) {
					return null;
				}
				return (
					<div className="flex flex-col gap-0.5" key={groupLabel ?? "main"}>
						{!collapsed && groupLabel ? (
							<p className="px-2 pb-1 font-medium text-muted-foreground text-xs">
								{groupLabel}
							</p>
						) : null}
						{items.map(({ href, label, icon: Icon }) => {
							const active =
								href === "/" ? pathname === "/" : pathname.startsWith(href);
							return (
								<Link
									aria-current={active ? "page" : undefined}
									aria-label={collapsed ? label : undefined}
									className={cn(
										"flex items-center gap-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground/80 focus-visible:outline-2 focus-visible:outline-ring",
										collapsed && "justify-center px-0",
										active &&
											"bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
									)}
									href={href}
									key={href}
									onClick={onNavigate}
									title={collapsed ? label : undefined}
								>
									<Icon aria-hidden className="size-4 shrink-0" />
									{!collapsed && <span className="truncate">{label}</span>}
								</Link>
							);
						})}
					</div>
				);
			})}
		</div>
	);
}
