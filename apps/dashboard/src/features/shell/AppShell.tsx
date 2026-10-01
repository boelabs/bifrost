"use client";

import { NavSkeleton, UserMenuSkeleton } from "./ShellSkeletons";
import type { OperatorIdentity } from "#/features/auth/common";
import { BifrostMark } from "#/shared/components/BifrostMark";
import { SessionProvider } from "#/features/auth/session";
import { ThemeSelect } from "#/shared/theme/ThemeSelect";
import { Button } from "#/components/ui/button";
import { usePathname } from "next/navigation";
import { cn } from "#/shared/lib/classes";
import { SidebarNav } from "./SidebarNav";
import { useSidebar } from "./useSidebar";
import { UserMenu } from "./UserMenu";
import { Suspense } from "react";
import Link from "next/link";

import {
	DialogBackdrop,
	DialogViewport,
	DialogPortal,
	DialogPopup,
	DialogTitle,
	DialogRoot,
} from "#/components/ui/dialog";

import {
	PanelLeftCloseIcon,
	PanelLeftOpenIcon,
	MenuIcon,
	XIcon,
} from "lucide-react";

export function AppShell({
	identity,
	children,
}: {
	identity: Promise<OperatorIdentity>;
	children: React.ReactNode;
}) {
	const playground = usePathname() === "/playground";
	const { collapsed, mobileOpen, setMobileOpen, toggle } = useSidebar();
	return (
		<SessionProvider identity={identity}>
			<div className="flex h-dvh overflow-hidden bg-background">
				<a
					className="sr-only fixed top-2 left-2 z-50 rounded-lg bg-primary p-3 text-primary-foreground focus:not-sr-only"
					href="#main-content"
				>
					Skip to content
				</a>
				<aside
					className={cn(
						"hidden h-full shrink-0 flex-col border-r bg-background transition-[width] duration-200 motion-reduce:transition-none md:flex",
						collapsed ? "w-16" : "w-56",
					)}
				>
					<SidebarContent collapsed={collapsed} onToggle={toggle} />
				</aside>
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
						<Button
							aria-expanded={mobileOpen}
							aria-label="Open sidebar"
							className="md:hidden"
							mode="icon"
							onClick={() => setMobileOpen(true)}
							variant="ghost"
						>
							<MenuIcon aria-hidden="true" />
						</Button>
						<div className="ms-auto flex items-center gap-1">
							<ThemeSelect compact />
							<Suspense fallback={<UserMenuSkeleton collapsed />}>
								<UserMenu collapsed />
							</Suspense>
						</div>
					</header>
					<main
						className="min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
						id="main-content"
						tabIndex={-1}
					>
						<div
							className={cn(
								"mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6",
								playground ? "h-full min-h-0" : "min-h-full",
							)}
						>
							{children}
						</div>
					</main>
				</div>
				<DialogRoot onOpenChange={setMobileOpen} open={mobileOpen}>
					<DialogPortal>
						<DialogBackdrop />
						<DialogViewport className="flex items-stretch justify-start p-0 max-sm:pt-0">
							<DialogPopup
								borderRadius={0}
								className="h-dvh max-h-dvh max-w-[calc(100vw-3rem)] gap-0 bg-background p-0"
								width="16rem"
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
	const desktopIcon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;
	const ToggleIcon = mobile ? XIcon : desktopIcon;
	const desktopLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
	return (
		<div className="flex h-full flex-col gap-3 px-2 py-3">
			<div className="flex shrink-0 items-center justify-between gap-2 border-b pb-3">
				{!collapsed && (
					<Link
						className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
						href="/"
						onClick={onNavigate}
					>
						<BifrostMark decorative size={24} />
						<span className="font-semibold text-base">Bifrost</span>
					</Link>
				)}
				<Button
					aria-expanded={!collapsed}
					aria-label={mobile ? "Close sidebar" : desktopLabel}
					mode="icon"
					onClick={onToggle}
					size="sm"
					title={mobile ? "Close sidebar" : "Toggle sidebar (Ctrl/⌘ B)"}
					variant="ghost"
				>
					<ToggleIcon aria-hidden="true" />
				</Button>
			</div>
			<nav
				aria-label="Main navigation"
				className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
			>
				<Suspense fallback={<NavSkeleton collapsed={collapsed} />}>
					<SidebarNav collapsed={collapsed} onNavigate={onNavigate} />
				</Suspense>
			</nav>
			<div className="border-t pt-3">
				<Suspense fallback={<NavSkeleton collapsed={collapsed} footer />}>
					<SidebarNav collapsed={collapsed} footer onNavigate={onNavigate} />
				</Suspense>
			</div>
		</div>
	);
}
