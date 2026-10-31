import type { Permission } from "#/features/auth/common.ts";
import type { LucideIcon } from "lucide-react";

import {
	SlidersHorizontal,
	MessagesSquare,
	ChartColumn,
	ShieldCheck,
	ScrollText,
	ChartLine,
	KeyRound,
	Boxes,
	Users,
	Plug,
} from "lucide-react";

/** A quiet sidebar row; the page open is `bg-primary/10 text-primary` (`aria-current`). */
export const NAV_ROW =
	"flex items-center gap-2 rounded-lg p-2 text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-accent-foreground/80 hover:transition-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary [&_svg]:size-4 [&_svg]:shrink-0";

export interface NavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	/** Every permission listed must be granted for the item to appear. */
	requires: Permission[];
	/** Active only on its own path, not on the pages nested under it. */
	exact?: boolean;
	/** The letter that opens it after `g` (`g` then `m`: Models). */
	key?: string;
}

export interface NavGroup {
	label: string | null;
	items: NavItem[];
}

/**
 * The single list of pages: the sidebar, the command palette and the `g` shortcuts all read it.
 *
 * Navigation is derived from the role, not hardcoded per page: an operator is never shown a section
 * whose API calls would come back 403. The gateway remains the authority — this only avoids dead ends.
 */
export const NAVIGATION: NavGroup[] = [
	{
		label: null,
		items: [
			{
				href: "/",
				label: "Overview",
				icon: ChartLine,
				requires: ["usage:read"],
				exact: true,
				key: "o",
			},
			{
				href: "/metrics",
				label: "Metrics",
				icon: ChartColumn,
				requires: ["usage:read"],
				key: "x",
			},
		],
	},
	{
		label: "Gateway",
		items: [
			{
				href: "/models",
				label: "Models",
				icon: Boxes,
				requires: ["deployments:read"],
				key: "m",
			},
			{
				href: "/keys",
				label: "API keys",
				icon: KeyRound,
				requires: ["keys:read"],
				key: "k",
			},
			{
				href: "/playground",
				label: "Playground",
				icon: MessagesSquare,
				requires: ["inference:use"],
				key: "p",
			},
			{
				href: "/logs",
				label: "Logs",
				icon: ScrollText,
				requires: ["logs:read"],
				key: "l",
			},
		],
	},
	{
		label: "Administration",
		items: [
			{
				href: "/extensions",
				label: "Extensions",
				icon: Plug,
				requires: ["settings:read"],
				key: "e",
			},
			{
				href: "/settings",
				label: "Settings",
				icon: SlidersHorizontal,
				requires: ["settings:read"],
				key: ",",
			},
			{
				href: "/users",
				label: "Users",
				icon: Users,
				requires: ["users:manage"],
				key: "u",
			},
			{
				href: "/audit",
				label: "Audit",
				icon: ShieldCheck,
				requires: ["audit:read"],
				key: "a",
			},
		],
	},
];

/** What the command palette and `c` then a letter create, for the roles that may. */
export interface CreateAction extends NavItem {
	command: string;
}

export const CREATE_ACTIONS: CreateAction[] = [
	{
		href: "/models/new",
		label: "Deployment",
		command: "Create deployment",
		icon: Boxes,
		requires: ["deployments:write"],
		key: "d",
	},
	{
		href: "/keys/new",
		label: "API key",
		command: "Create API key",
		icon: KeyRound,
		requires: ["keys:write"],
		key: "k",
	},
];

/** Whether an entry is the page open, or a page nested under it. */
export function isActive(item: NavItem, pathname: string): boolean {
	return (
		pathname === item.href ||
		(!item.exact && pathname.startsWith(`${item.href}/`))
	);
}

/** The groups an operator sees: entries their role can use, and no empty group. */
export function visibleNavigation(
	can: (...permissions: Permission[]) => boolean,
): NavGroup[] {
	return NAVIGATION.map((group) => ({
		...group,
		items: group.items.filter((item) => can(...item.requires)),
	})).filter((group) => group.items.length > 0);
}

export function visibleCreateActions(
	can: (...permissions: Permission[]) => boolean,
): CreateAction[] {
	return CREATE_ACTIONS.filter((action) => can(...action.requires));
}

/** Where a two-key shortcut leads: `g` goes to a page, `c` creates; `null` when it is none. */
export function shortcutHref(
	prefix: "g" | "c",
	key: string,
	can: (...permissions: Permission[]) => boolean,
): string | null {
	const items =
		prefix === "g"
			? visibleNavigation(can).flatMap((group) => group.items)
			: visibleCreateActions(can);
	return items.find((item) => item.key === key)?.href ?? null;
}
