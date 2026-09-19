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
					className="sr-only fixed top-2 left-2 z-50 rounded-lg bg-primary p-3 text-primary-fg focus:not-sr-only"
					href="#main-content"
				>
					Skip to content
				</a>
				<aside
					className={cn(
						"hidden h-full shrink-0 flex-col border-sidebar-border border-r bg-sidebar transition-[width] duration-200 motion-reduce:transition-none md:flex",
						collapsed ? "w-16" : "w-64",
					)}
				>
					<SidebarContent collapsed={collapsed} onToggle={toggle} />
				</aside>
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="flex h-14 shrink-0 items-center gap-3 border-border/40 border-b px-4 md:hidden">
						<Button
							aria-expanded={mobileOpen}
							aria-label="Open sidebar"
							mode="icon"
							onClick={() => setMobileOpen(true)}
							size="sm"
							variant="ghost"
						>
							<IconLayoutSidebarLeftExpand aria-hidden className="size-5" />
						</Button>
						<BifrostMark size={18} />
					</header>
					<main
						className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8"
						id="main-content"
						tabIndex={-1}
					>
						{children}
					</main>
				</div>
				<DialogRoot onOpenChange={setMobileOpen} open={mobileOpen}>
					<DialogPortal>
						<DialogBackdrop />
						<DialogViewport className="justify-start p-0">
							<DialogPopup
								borderRadius={0}
								className="h-dvh max-h-dvh max-w-[calc(100vw-3rem)] gap-0 bg-sidebar p-0"
								width="18rem"
							>
								<DialogTitle className="sr-only">Navigation</DialogTitle>
								<SidebarContent
									collapsed={false}
									mobile
									onNavigate={() => setMobileOpen(false)}
									onToggle={() => setMobileOpen(false)}
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
				{/* The mark alone: it spells the name, and setting the word beside it says the same
				    thing twice. Collapsed, the 64px rail is the toggle's. */}
				{!collapsed && (
					// The inset goes on a wrapper, never on the image: Tailwind's preflight sets
					// `height: auto`, so padding inside the declared width shrinks the mark's height
					// with it and the bridge comes out flattened.
					<span className="px-2">
						<BifrostMark size={20} />
					</span>
				)}
				<Button
					aria-expanded={!collapsed}
					aria-label={
						mobile
							? "Close sidebar"
							: collapsed
								? "Expand sidebar"
								: "Collapse sidebar"
					}
					mode="icon"
					onClick={onToggle}
					size="sm"
					title={mobile ? "Close sidebar" : "Toggle sidebar (Ctrl/⌘ B)"}
					variant="ghost"
				>
					<ToggleIcon aria-hidden className="size-5 text-fg-muted" />
				</Button>
			</div>
			<nav
				aria-label="Main navigation"
				className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2"
			>
				{!collapsed && (
					<p className="px-3 pb-2 font-medium text-fg-muted text-xs">
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
			<div className="shrink-0 border-sidebar-border border-t p-2">
				<Suspense fallback={<UserMenuSkeleton collapsed={collapsed} />}>
					<UserMenu collapsed={collapsed} />
				</Suspense>
			</div>
		</>
	);
}
