"use client";

import { createContext, Suspense, use, useMemo, useState } from "react";
import { type KeyDraft, toCreateBody, toUpdateBody } from "./draft.ts";
import { useIdempotencyKey } from "#/shared/lib/useIdempotencyKey.ts";
import type { CreatedVirtualKey, VirtualKey } from "./common.ts";
import { createKeyAction, updateKeyAction } from "./actions.ts";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { useMutation } from "#/shared/lib/mutation.ts";
import { Button } from "#/components/ui/button";
import { IconCopy } from "@tabler/icons-react";
import { KeyDialog } from "./KeyDialog.tsx";

import {
	DialogHeader,
	DialogFooter,
	DialogBody,
	Dialog,
	Modal,
} from "#/components/ui/modal";

/** `key: null` opens the dialog for a new key; a row opens it for editing that one. */
type Editing = { key: VirtualKey | null } | null;

/**
 * Only the dialog. Row actions live in the table, where `useRowActions` can draw the row as it will
 * be while the call is in flight.
 */
interface KeysValue {
	openNew: () => void;
	edit: (key: VirtualKey) => void;
}

const KeysContext = createContext<KeysValue | null>(null);

export function useKeys(): KeysValue {
	const value = use(KeysContext);
	if (!value) {
		throw new Error("useKeys must be used inside KeysProvider");
	}
	return value;
}

/** Just the button's half of the context, for the toolbar up in the page header. */
export function useNewKey(): () => void {
	return useKeys().openNew;
}

/**
 * The keys page's interactive state, above both boundaries that need it.
 *
 * The "New key" button is in the page header and the table is further down the page, in a different
 * `<Suspense>` boundary; they share one dialog rather than each rendering their own. `models` arrives
 * as an unawaited promise so this provider — and therefore the whole header — stays out of the
 * gateway's critical path: it is only unwrapped once a dialog is actually open.
 */
export function KeysProvider({
	models,
	children,
}: {
	models: Promise<string[]>;
	children: React.ReactNode;
}) {
	const confirm = useConfirm();
	const { pending, run } = useMutation();
	const issueKey = useIdempotencyKey();
	const [editing, setEditing] = useState<Editing>(null);
	const [issued, setIssued] = useState<CreatedVirtualKey | null>(null);

	const value = useMemo<KeysValue>(
		() => ({
			openNew: () => setEditing({ key: null }),
			edit: (key) => setEditing({ key }),
		}),
		[],
	);

	async function save(draft: KeyDraft): Promise<boolean> {
		const target = editing?.key;
		if (target) {
			const body = toUpdateBody(draft, target);
			if (Object.keys(body).length === 0) {
				return true;
			}
			const result = await run(() => updateKeyAction(target.id, body), {
				success: `${draft.name.trim()} updated`,
				failure: "The key could not be updated.",
			});
			return result.ok;
		}
		const result = await run(
			() => createKeyAction(toCreateBody(draft), issueKey.key()),
			{
				success: `${draft.name.trim()} created`,
				failure: "The key could not be created.",
			},
		);
		if (result.ok) {
			issueKey.rotate();
			setIssued(result.data);
		}
		return result.ok;
	}

	async function resetSpend(key: VirtualKey) {
		const confirmed = await confirm({
			title: `Reset the spend on ${key.name}?`,
			description:
				"The budget counter starts over at zero. Past usage stays in the logs; only the counter moves.",
			confirmLabel: "Reset spend",
			tone: "primary",
		});
		if (!confirmed) {
			return;
		}
		setEditing(null);
		await run(() => updateKeyAction(key.id, { resetSpend: true }), {
			success: `Spend reset on ${key.name}`,
			failure: "The spend could not be reset.",
		});
	}

	return (
		<KeysContext value={value}>
			{children}
			{editing ? (
				// The suggestions are almost always resolved by the time anyone clicks, but a boundary
				// here means an early click delays the dialog rather than blanking the page behind it.
				<Suspense fallback={null}>
					<KeyEditor
						existing={editing.key}
						/* Remount per target: the form is seeded from the key it opened on. */
						key={editing.key?.id ?? "new"}
						models={models}
						onClose={() => setEditing(null)}
						onResetSpend={resetSpend}
						onSubmit={save}
						pending={pending}
					/>
				</Suspense>
			) : null}
			<IssuedKeyDialog issued={issued} onClose={() => setIssued(null)} />
		</KeysContext>
	);
}

/** Unwraps the model suggestions where suspending costs a dialog rather than the page. */
function KeyEditor({
	models,
	existing,
	pending,
	onClose,
	onSubmit,
	onResetSpend,
}: {
	models: Promise<string[]>;
	existing: VirtualKey | null;
	pending: boolean;
	onClose: () => void;
	onSubmit: (draft: KeyDraft) => Promise<boolean>;
	onResetSpend: (key: VirtualKey) => Promise<void>;
}) {
	return (
		<KeyDialog
			isOpen
			models={use(models)}
			pending={pending}
			{...(existing ? { existing } : {})}
			{...(existing ? { onResetSpend: () => void onResetSpend(existing) } : {})}
			onClose={onClose}
			onSubmit={onSubmit}
		/>
	);
}

/**
 * The plaintext key exists only in this one response — the gateway stores a SHA-256 hash and cannot
 * return it again — so the dialog is deliberately blunt about copying it now.
 */
function IssuedKeyDialog({
	issued,
	onClose,
}: {
	issued: CreatedVirtualKey | null;
	onClose: () => void;
}) {
	const [copied, setCopied] = useState(false);

	return (
		<Modal isOpen={issued !== null} onOpenChange={(open) => !open && onClose()}>
			<Dialog aria-label="New key created" layout="sectioned">
				<DialogHeader>
					<h2 className="font-semibold text-fg text-lg">Copy this key now</h2>
					<p className="pt-2 text-fg-muted text-sm">
						It is stored hashed and will never be shown again. If you lose it,
						create a new key and delete this one.
					</p>
				</DialogHeader>
				<DialogBody>
					<pre className="overflow-x-auto rounded-xl border border-border/50 bg-surface-2 px-3 py-2.5 font-mono text-fg text-xs">
						{issued?.key}
					</pre>
				</DialogBody>
				<DialogFooter>
					<Button
						onClick={async () => {
							if (issued) {
								await navigator.clipboard.writeText(issued.key);
							}
							setCopied(true);
						}}
						variant="secondary"
					>
						<IconCopy aria-hidden className="mr-2" size={15} />
						{copied ? "Copied" : "Copy"}
					</Button>
					<Button
						onClick={() => {
							setCopied(false);
							onClose();
						}}
					>
						Done
					</Button>
				</DialogFooter>
			</Dialog>
		</Modal>
	);
}
