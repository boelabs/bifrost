"use client";

import { visibleCreateActions, visibleNavigation } from "./navigation.ts";
import { useSession } from "#/features/auth/session.tsx";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DialogTitle } from "#/components/ui/dialog";
import { Button } from "#/components/ui/button";
import { useRecentPages } from "./RecentPages";
import { useDocsUrl } from "./Documentation";
import type { ReactNode } from "react";
import { areaOf } from "./recents.ts";

import {
	CommandDialogTrigger,
	CommandCreateHandle,
	CommandDialogPopup,
	CommandCollection,
	CommandGroupLabel,
	CommandDialog,
	CommandFooter,
	CommandPanel,
	CommandInput,
	CommandEmpty,
	CommandGroup,
	CommandList,
	CommandItem,
	Command,
} from "#/components/ui/command";

import {
	type LucideIcon,
	BookOpenIcon,
	HistoryIcon,
	SearchIcon,
	PinIcon,
} from "lucide-react";

/**
 * Ties the search buttons (sidebar, mobile bar) to the palette without the palette's root wrapping
 * the app: a root around the app would make every other dialog a nested one, which Base UI draws
 * without its backdrop.
 */
const palette = CommandCreateHandle();

export function CommandPalette({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.key.toLowerCase() !== "k" ||
				!(event.ctrlKey || event.metaKey) ||
				event.altKey ||
				event.shiftKey ||
				event.isComposing ||
				event.repeat
			) {
				return;
			}
			// Never steal focus from a confirmation or an unfinished form in another modal.
			if (
				!open &&
				document.querySelector(
					'[role="dialog"][data-open], [role="alertdialog"][data-open]',
				)
			) {
				return;
			}
			event.preventDefault();
			setOpen((value) => !value);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open]);

	return (
		<>
			{children}
			<CommandDialog handle={palette} onOpenChange={setOpen} open={open}>
				<CommandDialogPopup>
					<DialogTitle className="sr-only">Search Bifrozz</DialogTitle>
					{open ? (
						<Suspense fallback={null}>
							<PaletteContent onNavigate={() => setOpen(false)} />
						</Suspense>
					) : null}
				</CommandDialogPopup>
			</CommandDialog>
		</>
	);
}

/** A quiet square search button: its name and title carry the action and its shortcut. */
export function CommandPaletteTrigger() {
	return (
		<CommandDialogTrigger
			handle={palette}
			render={
				<Button
					aria-keyshortcuts="Control+k Meta+k"
					aria-label="Search Bifrozz"
					className="text-muted-foreground"
					mode="icon"
					title="Search Bifrozz (Ctrl/⌘+K)"
					variant="ghost"
				/>
			}
		>
			<SearchIcon aria-hidden="true" />
		</CommandDialogTrigger>
	);
}

/** An option of the palette: a page, a create action or a remembered record and its area. */
interface PaletteItem {
	href: string;
	label: string;
	icon: LucideIcon;
	detail?: string | undefined;
	/** Outside the dashboard (the documentation): opens in a new tab, never in place of it. */
	external?: boolean;
}

function PaletteContent({ onNavigate }: { onNavigate: () => void }) {
	const router = useRouter();
	const pathname = usePathname();
	const { can } = useSession();
	const { pages } = useRecentPages();
	const docs = useDocsUrl();
	const [search, setSearch] = useState("");
	const term = search.trim().toLowerCase();
	// The page open now is never an option to open.
	const remembered = (pinned: boolean): PaletteItem[] =>
		pages
			.filter((page) => page.pinned === pinned && page.href !== pathname)
			.map((page) => ({
				href: page.href,
				label: page.title,
				icon: pinned ? PinIcon : HistoryIcon,
				detail: areaOf(page.href),
			}));
	const all: Array<{ value: string; items: PaletteItem[] }> = [
		{ value: "Pinned", items: remembered(true) },
		{ value: "Recent", items: remembered(false) },
		...visibleNavigation(can).map((group) => ({
			value: group.label ?? "Go to",
			items: group.items,
		})),
		{
			value: "Help",
			items: docs
				? [
						{
							href: docs,
							label: "Documentation",
							icon: BookOpenIcon,
							external: true,
						},
					]
				: [],
		},
		{
			value: "Create",
			items: visibleCreateActions(can).map((action) => ({
				...action,
				label: action.command,
			})),
		},
	];
	const groups = all
		.map((group) => ({
			...group,
			items: group.items.filter((item) =>
				`${group.value} ${item.label} ${item.detail ?? ""}`
					.toLowerCase()
					.includes(term),
			),
		}))
		.filter((group) => group.items.length > 0);
	return (
		<Command
			filter={null}
			items={groups}
			onValueChange={setSearch}
			value={search}
		>
			<CommandInput
				aria-label="Search pages and actions"
				maxLength={100}
				placeholder="Pages and actions…"
			/>
			<CommandPanel>
				<CommandEmpty>No matches.</CommandEmpty>
				<CommandList>
					{(group: { value: string; items: PaletteItem[] }) => (
						<CommandGroup items={group.items} key={group.value}>
							<CommandGroupLabel>{group.value}</CommandGroupLabel>
							<CommandCollection>
								{(item: PaletteItem) => (
									<CommandItem
										className="gap-2"
										key={item.href}
										onClick={() => {
											onNavigate();
											if (item.external) {
												window.open(item.href, "_blank", "noopener,noreferrer");
											} else {
												router.push(item.href);
											}
										}}
										value={item.href}
									>
										<item.icon aria-hidden="true" className="size-4 shrink-0" />
										<span className="min-w-0 truncate">{item.label}</span>
										{item.detail ? (
											<span className="ms-auto shrink-0 text-muted-foreground/72 text-xs">
												{item.detail}
											</span>
										) : null}
									</CommandItem>
								)}
							</CommandCollection>
						</CommandGroup>
					)}
				</CommandList>
			</CommandPanel>
			<CommandFooter>
				<span>↑ ↓ Choose · Enter Open</span>
				<span>Esc Close</span>
			</CommandFooter>
		</Command>
	);
}
