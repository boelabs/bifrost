/**
 * Copies a value that is still on its way from the server.
 *
 * Safari lets a page write to the clipboard only during the click that asked for it, and a value
 * fetched after that click arrives too late. A `ClipboardItem` built from the pending value starts
 * the write inside the gesture and lets the browser wait for the data, which every current browser
 * accepts. Where that is missing, the plain write after the value arrives is what those browsers
 * allow anyway.
 *
 * Call it synchronously from the event handler: an `await` before it ends the gesture. `load`
 * resolving to `null` means "nothing to copy" — the caller already knows why — and is not a failure
 * of the clipboard.
 */
export async function copyPending(
	load: () => Promise<string | null>,
): Promise<boolean> {
	const pending = load();
	if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
		const blob = pending.then((loaded) => {
			if (loaded === null) {
				throw new Error("Nothing to copy");
			}
			return new Blob([loaded], { type: "text/plain" });
		});
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ "text/plain": blob }),
			]);
			return true;
		} catch {
			// The value never came, or this browser refuses a pending item: only the second is
			// worth a plain write.
			if ((await pending.catch(() => null)) === null) {
				return false;
			}
		}
	}
	const value = await pending.catch(() => null);
	if (value === null) {
		return false;
	}
	try {
		await navigator.clipboard.writeText(value);
		return true;
	} catch {
		return false;
	}
}
