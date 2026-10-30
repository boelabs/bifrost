"use client";

import { CommandPalette, CommandPaletteTrigger } from "./CommandPalette";
import { ScrollArea } from "#/components/ui/primitives/scroll-area";
import { NavSkeleton, UserMenuSkeleton } from "./ShellSkeletons";
import type { OperatorIdentity } from "#/features/auth/common";
import { BifrozzMark } from "#/shared/components/BifrozzMark";
import { SessionProvider } from "#/features/auth/session";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { Button } from "#/components/ui/button";
import { Suspense, useState } from "react";
import { SidebarNav } from "./SidebarNav";
import { CreateMenu } from "./CreateMenu";
import { MenuIcon } from "lucide-react";
import { UserMenu } from "./UserMenu";
import Link from "next/link";

import {
	SheetTrigger,
	SheetPopup,
	SheetTitle,
	Sheet,
} from "#/components/ui/sheet";

/**
 * The authenticated frame, Billete's: a sidebar with the logo and search on top, the pages in the
 * middle and the operator at its foot. There is no header; on phones a slim bar opens the sidebar
 * as a sheet.
 */
export function AppShell({
	identity,
	children,
}: {
	identity: Promise<OperatorIdentity>;
	children: React.ReactNode;
}) {
	return (
		<SessionProvider identity={identity}>
			<CommandPalette>
				<KeyboardShortcuts>
					<div className="flex h-dvh overflow-hidden bg-background">
						<a
							className="sr-only fixed top-2 left-2 z-50 rounded-lg bg-primary p-3 text-primary-foreground focus:not-sr-only"
							href="#main-content"
						>
							Skip to content
						</a>
						<aside className="hidden w-(--app-sidebar-width) shrink-0 border-r bg-background md:block">
							<SidebarContent />
						</aside>
						<div className="flex min-w-0 flex-1 flex-col">
							<MobileBar />
							<main
								className="min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
								id="main-content"
								tabIndex={-1}
							>
								{/*
								 * A page that scrolls its own content (the playground's transcript) marks its
								 * root `data-fill-viewport` and gets exactly the main column's height. Read from
								 * the DOM rather than the pathname, which would keep dynamic routes from
								 * prerendering the shell.
								 */}
								<div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 p-4 has-data-fill-viewport:h-full has-data-fill-viewport:min-h-0 sm:p-6">
									{children}
								</div>
							</main>
						</div>
					</div>
				</KeyboardShortcuts>
			</CommandPalette>
		</SessionProvider>
	);
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
	return (
		<div className="flex h-full flex-col gap-3 px-2 py-3">
			<div className="flex shrink-0 items-center justify-between gap-2 border-b pb-3">
				<Link
					className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
					href="/"
					onClick={onNavigate}
				>
					<BifrozzMark decorative size={24} />
					<span className="font-semibold text-base">Bifrozz</span>
				</Link>
				<div className="hidden items-center gap-1 md:flex">
					<CommandPaletteTrigger />
					<Suspense fallback={null}>
						<CreateMenu onNavigate={onNavigate} />
					</Suspense>
				</div>
			</div>
			{/*
			 * Long lists scroll under a fade at the edge that has more. The area reaches past the
			 * sidebar's padding so its thin scrollbar sits against the border, clear of the links.
			 */}
			<ScrollArea
				className="-mx-2 min-h-0 w-auto flex-1"
				scrollbar="edge"
				scrollFade
			>
				<nav aria-label="Main" className="flex flex-col gap-4 px-2">
					<Suspense fallback={<NavSkeleton />}>
						<SidebarNav onNavigate={onNavigate} />
					</Suspense>
				</nav>
			</ScrollArea>
			<div className="flex shrink-0 flex-col gap-1 border-t pt-3">
				<Suspense fallback={<UserMenuSkeleton />}>
					<UserMenu onNavigate={onNavigate} />
				</Suspense>
			</div>
		</div>
	);
}

/** Phones have no room for the sidebar: this bar opens it as a sheet. */
function MobileBar() {
	const [open, setOpen] = useState(false);
	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:hidden">
			<Sheet onOpenChange={setOpen} open={open}>
				<SheetTrigger
					render={<Button aria-label="Open menu" mode="icon" variant="ghost" />}
				>
					<MenuIcon aria-hidden="true" />
				</SheetTrigger>
				<SheetPopup className="w-64 p-0" showCloseButton={false} side="left">
					<SheetTitle className="sr-only">Menu</SheetTitle>
					<SidebarContent onNavigate={() => setOpen(false)} />
				</SheetPopup>
			</Sheet>
			<Link
				className="flex items-center gap-2 rounded-md px-1 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
				href="/"
			>
				<BifrozzMark decorative size={20} />
				<span className="font-semibold text-base">Bifrozz</span>
			</Link>
			<CommandPaletteTrigger />
			<Suspense fallback={null}>
				<CreateMenu />
			</Suspense>
		</header>
	);
}
