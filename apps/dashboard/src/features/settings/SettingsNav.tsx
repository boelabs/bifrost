"use client";

import type { Permission } from "#/features/auth/common.ts";
import { useSession } from "#/features/auth/session.tsx";
import type { LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import Link from "next/link";

import {
	DatabaseZap,
	LockKeyhole,
	TimerReset,
	GitFork,
	Route,
} from "lucide-react";

interface SettingsSection {
	href: string;
	label: string;
	icon: LucideIcon;
	/** Every permission listed must be granted for the section to appear. */
	requires: Permission[];
}

/**
 * Sections by what they configure: the gateway every request goes through, or this dashboard.
 * Settings itself needs `settings:read`, so a section listing only that needs nothing more.
 */
const SETTINGS_GROUPS: { label: string; sections: SettingsSection[] }[] = [
	{
		label: "Gateway",
		sections: [
			{ href: "/settings", label: "Routing", icon: Route, requires: [] },
			{
				href: "/settings/timeouts",
				label: "Timeouts",
				icon: TimerReset,
				requires: [],
			},
			{
				href: "/settings/fallbacks",
				label: "Fallbacks",
				icon: GitFork,
				requires: [],
			},
			{
				href: "/settings/cache",
				label: "Response cache",
				icon: DatabaseZap,
				requires: ["settings:write"],
			},
		],
	},
	{
		label: "Dashboard",
		sections: [
			{
				href: "/settings/sessions",
				label: "Sessions",
				icon: LockKeyhole,
				requires: ["users:manage"],
			},
		],
	},
];

/** The groups an operator sees: sections their role can use, and no empty group. */
function visibleGroups(can: (...permissions: Permission[]) => boolean) {
	return SETTINGS_GROUPS.map((group) => ({
		...group,
		sections: group.sections.filter((section) => can(...section.requires)),
	})).filter((group) => group.sections.length > 0);
}

/**
 * The sections of Settings: a column beside the content on wide screens, a row of tabs that
 * scrolls sideways on phones.
 */
export function SettingsNav() {
	// Suspends inside the layout's own boundary until the identity is known.
	const { can } = useSession();
	return <SectionList groups={visibleGroups(can)} />;
}

/** While the identity loads: the sections every role sees, the rest resolving with it. */
export function SettingsNavFallback() {
	return <SectionList groups={visibleGroups((...p) => p.length === 0)} />;
}

function SectionList({ groups }: { groups: ReturnType<typeof visibleGroups> }) {
	const pathname = usePathname();
	return (
		<nav
			aria-label="Settings sections"
			className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:sticky lg:top-6 lg:mx-0 lg:self-start lg:overflow-visible lg:px-0"
		>
			{/* Phones: one row, groups apart by a hairline. Wide screens: a column of titled groups. */}
			<div className="flex gap-1 lg:flex-col lg:gap-5">
				{groups.map((group) => (
					<div
						className="flex gap-1 border-s ps-1 first:border-s-0 first:ps-0 lg:flex-col lg:border-s-0 lg:ps-0"
						key={group.label}
					>
						<h2 className="hidden px-2.5 pb-1 font-medium text-muted-foreground text-xs lg:block">
							{group.label}
						</h2>
						<ul className="flex gap-1 lg:flex-col">
							{group.sections.map((section) => (
								<li key={section.href}>
									<SectionLink
										active={pathname === section.href}
										section={section}
									/>
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</nav>
	);
}

/** One section among its siblings, as a quiet link like the sidebar's rows. */
function SectionLink({
	section,
	active,
}: {
	section: SettingsSection;
	active: boolean;
}) {
	const ref = useRef<HTMLAnchorElement>(null);
	// In a row that scrolls sideways (phones), the open section is brought into view, not cut off.
	useEffect(() => {
		if (active) {
			ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
		}
	}, [active]);
	const Icon = section.icon;
	return (
		<Link
			aria-current={active ? "page" : undefined}
			className="flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-muted-foreground text-sm outline-none transition-colors hover:bg-accent/50 hover:text-accent-foreground/80 hover:transition-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary [&_svg]:size-4 [&_svg]:shrink-0"
			href={section.href}
			ref={ref}
		>
			<Icon aria-hidden="true" />
			{section.label}
		</Link>
	);
}
