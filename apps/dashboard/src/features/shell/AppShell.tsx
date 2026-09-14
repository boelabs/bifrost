"use client";

import { NavSkeleton, UserMenuSkeleton } from "./ShellSkeletons.tsx";
import type { OperatorIdentity } from "#/features/auth/common.ts";
import { BifrostMark } from "#/shared/components/BifrostMark.tsx";
import { SessionProvider } from "#/features/auth/session.tsx";
import { Button } from "#/components/ui/button";
import { SidebarNav } from "./SidebarNav.tsx";
import { useSidebar } from "./useSidebar.ts";
import { UserMenu } from "./UserMenu.tsx";
import { Suspense } from "react";
import { cn } from "cn";

import {
	DialogBackdrop,
	DialogViewport,
	DialogPortal,
	DialogPopup,
	DialogTitle,
	DialogRoot,
} from "#/components/ui/dialog";

import {
	IconLayoutSidebarLeftCollapse,
	IconLayoutSidebarLeftExpand,
	IconX,
} from "@tabler/icons-react";

/**
 * The chrome every authenticated page hangs off.
 *
 * Everything drawn here is static — no data, no session — so Next puts it in the route's App Shell
 * and the browser paints it the instant a sidebar link is clicked. The two parts that *do* need the
 * operator (which sections their role can see, and who they are) sit behind their own `<Suspense>`
 * boundaries and stream into skeletons of exactly their own size, so nothing below them moves when
 * the answer lands.
 */
export function AppShell({
	identity,
	children,
}: {
	/** Unawaited on purpose — see `features/auth/session.tsx`. */
	identity: Promise<OperatorIdentity>;
	children: React.ReactNode;
}) {
	const { collapsed, mobileOpen, setMobileOpen, toggle } = useSidebar();
	return (
		<SessionProvider identity={identity}>
			<div className="flex h-dvh overflow-hidden bg-surface">
				<a
					href="#main-content"
					className="sr-only fixed left-2 top-2 z-50 rounded-lg bg-primary p-3 text-primary-fg focus:not-sr-only"
				>
					Skip to content
				</a>
				<aside
					className={cn(
						"hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 motion-reduce:transition-none md:flex",
						collapsed ? "w-16" : "w-64",
					)}
				>
					<SidebarContent collapsed={collapsed} onToggle={toggle} />
				</aside>
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/40 px-4 md:hidden">
						<Button
							variant="ghost"
							size="sm"
							mode="icon"
							aria-label="Open sidebar"
							aria-expanded={mobileOpen}
							onClick={() => setMobileOpen(true)}
						>
							<IconLayoutSidebarLeftExpand aria-hidden className="size-5" />
						</Button>
						<BifrostMark size={16} />
						<span className="font-semibold">Bifrost</span>
					</header>
					<main
						id="main-content"
						tabIndex={-1}
						className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8"
					>
						{children}
					</main>
				</div>
				<DialogRoot open={mobileOpen} onOpenChange={setMobileOpen}>
					<DialogPortal>
						<DialogBackdrop />
						<DialogViewport className="justify-start p-0">
							<DialogPopup
								className="h-dvh max-h-dvh max-w-[calc(100vw-3rem)] gap-0 bg-sidebar p-0"
								width="18rem"
								borderRadius={0}
							>
								<DialogTitle className="sr-only">Navigation</DialogTitle>
								<SidebarContent
									collapsed={false}
									mobile
									onToggle={() => setMobileOpen(false)}
									onNavigate={() => setMobileOpen(false)}
								/>
							</DialogPopup>
						</DialogViewport>
					</DialogPortal>
				</DialogRoot>
			</div>
		</SessionProvider>
	);
}

function SidebarContent({
	collapsed,
	mobile = false,
	onToggle,
	onNavigate,
}: {
	collapsed: boolean;
	mobile?: boolean;
	onToggle: () => void;
	onNavigate?: () => void;
}) {
	const ToggleIcon = mobile
		? IconX
		: collapsed
			? IconLayoutSidebarLeftExpand
			: IconLayoutSidebarLeftCollapse;
	return (
		<>
			<div
				className={cn(
					"flex h-16 shrink-0 items-center gap-2 px-3",
					collapsed ? "justify-center" : "justify-between",
				)}
			>
				{/* Collapsed, the rail is 64px and the toggle already fills it; the mark would not fit
				    beside it, and a brand that overflows its own sidebar is worse than no brand. */}
				{!collapsed && (
					<span className="flex min-w-0 items-center gap-2 px-2">
						<BifrostMark size={16} />
						<span className="truncate font-semibold tracking-tight">
							Bifrost
						</span>
					</span>
				)}
				<Button
					variant="ghost"
					size="sm"
					mode="icon"
					aria-label={
						mobile
							? "Close sidebar"
							: collapsed
								? "Expand sidebar"
								: "Collapse sidebar"
					}
					title={mobile ? "Close sidebar" : "Toggle sidebar (Ctrl/⌘ B)"}
					aria-expanded={!collapsed}
					onClick={onToggle}
				>
					<ToggleIcon aria-hidden className="size-5 text-fg-muted" />
				</Button>
			</div>
			<nav
				aria-label="Main navigation"
				className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2"
			>
				{!collapsed && (
					<p className="px-3 pb-2 text-xs font-medium text-fg-muted">
						Workspace
					</p>
				)}
				<Suspense fallback={<NavSkeleton collapsed={collapsed} />}>
					<SidebarNav
						collapsed={collapsed}
						{...(onNavigate ? { onNavigate } : {})}
					/>
				</Suspense>
			</nav>
			<div className="shrink-0 border-t border-sidebar-border p-2">
				<Suspense fallback={<UserMenuSkeleton collapsed={collapsed} />}>
					<UserMenu collapsed={collapsed} />
				</Suspense>
			</div>
		</>
	);
}
