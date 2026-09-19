"use client";

import { describeError, useNotify } from "#/shared/feedback/notifications.tsx";
import type { ActionResult } from "#/shared/lib/action.ts";

import {
	useTransition,
	useCallback,
	useEffect,
	useState,
	useMemo,
} from "react";

export interface MutationOptions {
	/** Announced on success. Name the thing that changed, not the verb that changed it. */
	success?: string;
	/** Shown when the gateway gives no message of its own. */
	failure?: string;
}

/**
 * One call, one outcome the operator can see.
 *
 * The call itself is a Server Action, and the action is what revalidates: a successful mutation ends
 * with `revalidatePath` on the server, so the page comes back showing what the gateway actually
 * stored rather than what we assumed it would. Running the action inside a transition is what makes
 * `pending` cover the *whole* round trip — the request, the revalidated render, and React applying
 * it — instead of ending the moment the promise settles and leaving a gap where the table still
 * shows the old row.
 */
export function useMutation() {
	const [pending, startTransition] = useTransition();
	const notify = useNotify();

	const run = useCallback(
		<T>(
			action: () => Promise<ActionResult<T>>,
			options: MutationOptions = {},
		): Promise<ActionResult<T>> =>
			new Promise((resolve) => {
				startTransition(async () => {
					let result: ActionResult<T>;
					try {
						result = await action();
					} catch (cause) {
						// A transport failure rather than a rejection from the gateway: the action never
						// ran, or the response never arrived.
						result = {
							ok: false,
							message: describeError(
								cause,
								options.failure ?? "The request failed.",
							),
							status: null,
							code: null,
						};
					}
					if (result.ok) {
						if (options.success) {
							notify.success(options.success);
						}
					} else {
						notify.error(
							result.message || options.failure || "The request failed.",
						);
					}
					resolve(result);
				});
			}),
		[notify],
	);

	return { pending, run };
}

/** `"removed"` hides the row outright; a partial patch edits it in place. */
export type RowPatch<T> = Partial<T> | "removed";

export interface RowAction<T> extends MutationOptions {
	/** How the row should look while the call is in flight. */
	optimistic?: RowPatch<T>;
	action: () => Promise<ActionResult<unknown>>;
}

/**
 * Table rows with in-flight changes already applied.
 *
 * A round trip to the gateway plus a revalidated render is long enough for a toggle to feel broken,
 * so the row is drawn as it will be and corrected if the call fails. Patches are dropped when the
 * transition settles rather than when the promise resolves: by then the server has re-rendered and
 * the rows on screen are the gateway's version, so keeping a patch on top of them would only mask
 * what actually happened.
 */
export function useRowActions<T>(
	rows: readonly T[],
	keyOf: (row: T) => string,
) {
	const { pending, run } = useMutation();
	const [patches, setPatches] = useState<ReadonlyMap<string, RowPatch<T>>>(
		new Map(),
	);

	useEffect(() => {
		if (pending) {
			return;
		}
		setPatches((current) => (current.size === 0 ? current : new Map()));
	}, [pending]);

	const act = useCallback(
		async (key: string, { optimistic, action, ...options }: RowAction<T>) => {
			if (optimistic) {
				setPatches((current) => new Map(current).set(key, optimistic));
			}
			return run(action, options);
		},
		[run],
	);

	const visible = useMemo(() => {
		if (patches.size === 0) {
			return rows;
		}
		const result: T[] = [];
		for (const row of rows) {
			const value = patches.get(keyOf(row));
			if (value === "removed") {
				continue;
			}
			result.push(value ? { ...row, ...value } : row);
		}
		return result;
	}, [rows, patches, keyOf]);

	return { rows: visible, act, pending };
}
