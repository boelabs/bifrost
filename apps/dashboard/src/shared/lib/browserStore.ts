/**
 * A convenience this browser keeps in `localStorage` (the sidebar's Pinned, the palette's Recent).
 * Storage may be missing, unreadable or full at any time, so every access is guarded and
 * nothing depends on it. A write is announced on this tab's window with `event`; other tabs hear the
 * `storage` event, so every open tab stays in step.
 */
export function browserStore<T>(
	event: string,
	parse: (raw: string | null) => T,
) {
	function read(key: string): string | null {
		try {
			return window.localStorage.getItem(key);
		} catch {
			return null;
		}
	}

	function update(key: string, change: (value: T) => T) {
		try {
			window.localStorage.setItem(
				key,
				JSON.stringify(change(parse(read(key)))),
			);
		} catch {
			// Storage full or blocked (private window): the change simply is not kept.
			return;
		}
		window.dispatchEvent(new Event(event));
	}

	function subscribe(onChange: () => void) {
		window.addEventListener(event, onChange);
		window.addEventListener("storage", onChange);
		return () => {
			window.removeEventListener(event, onChange);
			window.removeEventListener("storage", onChange);
		};
	}

	return { read, update, subscribe };
}

/** A stored JSON value, or `undefined` when it is missing or not JSON. */
export function parseStored(raw: string | null): unknown {
	try {
		return raw ? JSON.parse(raw) : undefined;
	} catch {
		return undefined;
	}
}
