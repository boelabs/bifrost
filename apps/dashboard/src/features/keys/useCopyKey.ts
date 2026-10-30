"use client";

import { describeError, useNotify } from "#/shared/feedback/notifications.tsx";
import { copyPending } from "#/shared/lib/clipboard.ts";
import type { VirtualKey } from "./common.ts";
import { copyKeyAction } from "./actions.ts";
import { useState } from "react";

/**
 * Copies a key straight from the gateway to the clipboard.
 *
 * The secret never enters React state or the DOM: it exists in this tab only for as long as the
 * clipboard write takes. That keeps it out of the rendered page, devtools' component tree and any
 * screenshot of the screen — the protection against shoulder-surfing that "copy, not show" promises.
 * Who may copy it is the gateway's decision, and every copy is in its audit trail.
 */
export function useCopyKey() {
	const notify = useNotify();
	const [copying, setCopying] = useState<string | null>(null);

	function copy(key: Pick<VirtualKey, "id" | "name">) {
		setCopying(key.id);
		let failure: string | null = null;
		// No await before this call: the clipboard only accepts a write that starts inside the click.
		void copyPending(async () => {
			try {
				const result = await copyKeyAction(key.id);
				if (result.ok) {
					return result.data;
				}
				failure = result.message;
			} catch (cause) {
				failure = describeError(cause, "The key could not be copied.");
			}
			return null;
		})
			.then((copied) => {
				if (copied) {
					notify.success(`${key.name} copied`);
				} else {
					notify.error(
						failure ?? "The browser did not allow copying to the clipboard.",
					);
				}
			})
			.finally(() => setCopying(null));
	}

	return { copy, copying };
}
