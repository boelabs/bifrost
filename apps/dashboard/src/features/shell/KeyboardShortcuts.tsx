"use client";

import { useSession } from "#/features/auth/session.tsx";
import { Kbd, KbdGroup } from "#/components/ui/kbd";
import { Button } from "#/components/ui/button";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import {
	DialogDescription,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogClose,
	DialogBody,
	Dialog,
	Modal,
} from "#/components/ui/modal";

import {
	visibleCreateActions,
	visibleNavigation,
	shortcutHref,
} from "./navigation.ts";

import {
	createContext,
	useEffect,
	Suspense,
	useState,
	useRef,
	use,
} from "react";

/** How long the second key of a sequence (`g` then `m`) may wait for the first. */
const SEQUENCE_MS = 1500;

/**
 * Keys pressed while writing, or inside something that reads keys itself (a menu, a list, a
 * dialog), are never shortcuts.
 */
function isTypingTarget(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target.closest(
				'input, textarea, select, [role="menu"], [role="listbox"], [role="combobox"], [role="dialog"], [role="alertdialog"]',
			) !== null)
	);
}

const ShowShortcuts = createContext<() => void>(() => undefined);

/** Opens the list of keyboard shortcuts, as `?` does. */
export function useShowShortcuts() {
	return use(ShowShortcuts);
}

/**
 * The dashboard's keyboard shortcuts: `g` then a letter goes to a page, `c` then a letter creates,
 * `?` lists them all. Ctrl/⌘+K belongs to the command palette.
 *
 * The listener and the list read the operator's role, so each waits on the identity inside its own
 * boundary; the shell around them never does.
 */
export function KeyboardShortcuts({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<ShowShortcuts value={() => setOpen(true)}>
			{children}
			<Suspense fallback={null}>
				<ShortcutListener onHelp={() => setOpen(true)} />
			</Suspense>
			<Modal isOpen={open} onOpenChange={setOpen}>
				<Dialog aria-label="Keyboard shortcuts" layout="sectioned">
					<DialogHeader>
						<DialogTitle>Keyboard shortcuts</DialogTitle>
						<DialogDescription>
							Press the keys one after the other, outside text fields.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<Suspense fallback={null}>
							<ShortcutLists />
						</Suspense>
					</DialogBody>
					<DialogFooter>
						<DialogClose render={<Button variant="secondary" />}>
							Close
						</DialogClose>
					</DialogFooter>
				</Dialog>
			</Modal>
		</ShowShortcuts>
	);
}

function ShortcutListener({ onHelp }: { onHelp: () => void }) {
	const router = useRouter();
	const { can } = useSession();
	const pending = useRef<{ prefix: "g" | "c"; at: number } | null>(null);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const previous = pending.current;
			pending.current = null;
			if (
				event.defaultPrevented ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.isComposing ||
				event.repeat ||
				isTypingTarget(event.target)
			) {
				return;
			}
			if (event.key === "?") {
				event.preventDefault();
				onHelp();
				return;
			}
			if (event.shiftKey) {
				return;
			}
			const key = event.key.toLowerCase();
			if (previous && event.timeStamp - previous.at < SEQUENCE_MS) {
				const href = shortcutHref(previous.prefix, key, can);
				if (href) {
					event.preventDefault();
					router.push(href);
				}
				return;
			}
			if (key === "g" || key === "c") {
				pending.current = { prefix: key, at: event.timeStamp };
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [can, onHelp, router]);
	return null;
}

function ShortcutLists() {
	const { can } = useSession();
	const create = visibleCreateActions(can).flatMap((action) =>
		action.key ? [{ label: action.label, keys: ["C", action.key] }] : [],
	);
	return (
		<div className="grid gap-6 sm:grid-cols-2">
			<ShortcutList
				rows={visibleNavigation(can)
					.flatMap((group) => group.items)
					.flatMap((item) =>
						item.key ? [{ label: item.label, keys: ["G", item.key] }] : [],
					)}
				title="Go to"
			/>
			<div className="flex flex-col gap-6">
				{create.length > 0 ? (
					<ShortcutList rows={create} title="Create" />
				) : null}
				<ShortcutList
					rows={[
						{ label: "Search", keys: ["Ctrl/⌘", "K"] },
						{ label: "Show shortcuts", keys: ["?"] },
					]}
					title="General"
				/>
			</div>
		</div>
	);
}

/** The keys of a shortcut as keycaps: `G` `M`. */
export function ShortcutKeys({ keys }: { keys: readonly string[] }) {
	return (
		<KbdGroup>
			{keys.map((key) => (
				<Kbd key={key}>{key.toUpperCase()}</Kbd>
			))}
		</KbdGroup>
	);
}

function ShortcutList({
	title,
	rows,
}: {
	title: string;
	rows: Array<{ label: string; keys: readonly string[] }>;
}) {
	return (
		<section className="flex flex-col gap-1">
			<h3 className="font-medium text-muted-foreground text-xs">{title}</h3>
			<ul className="flex flex-col">
				{rows.map((row) => (
					<li
						className="flex items-center justify-between gap-4 py-1 text-sm"
						key={row.label}
					>
						{row.label}
						<ShortcutKeys keys={row.keys} />
					</li>
				))}
			</ul>
		</section>
	);
}
