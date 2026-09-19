"use client";

import type { Permission } from "#/features/auth/common.ts";
import { useSession } from "#/features/auth/session.tsx";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "cn";

import {
	IconAdjustmentsHorizontal,
	IconPlugConnected,
	IconShieldLock,
	IconChartLine,
	IconChartBar,
	IconMessages,
	IconPackages,
	IconUsers,
	IconLogs,
	IconKey,
} from "@tabler/icons-react";

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
}: {
	collapsed: boolean;
	onNavigate?: () => void;
}) {
	// Suspends here, inside the shell's own boundary, until the gateway answers with the identity.
	const { can } = useSession();
	const pathname = usePathname();
	return (
		<>
			{NAV.filter((item) => can(...item.requires)).map(
				({ href, label, icon: Icon }) => {
					const active =
						href === "/" ? pathname === "/" : pathname.startsWith(href);
					return (
						<Link
							aria-current={active ? "page" : undefined}
							aria-label={collapsed ? label : undefined}
							className={cn(
								"flex min-h-11 items-center gap-3 rounded-[var(--ui-radius-control)] px-3.5 py-2.5 text-fg-muted text-sm transition-colors hover:bg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-focus",
								collapsed && "justify-center px-0",
								active && "bg-secondary font-medium text-secondary-fg",
							)}
							href={href}
							key={href}
							onClick={onNavigate}
							title={collapsed ? label : undefined}
						>
							<Icon aria-hidden className="size-4.5 shrink-0" />
							{!collapsed && <span className="truncate">{label}</span>}
						</Link>
					);
				},
			)}
		</>
	);
}
