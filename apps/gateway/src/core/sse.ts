/**
 * Server-Sent Events parser over a byte ReadableStream. Emits one object per event with its `data:`
 * lines concatenated. Tolerant of CRLF and multi-line events.
 */
export interface SSEEvent {
	event?: string;
	data: string;
}

export async function* parseSSE(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let dataLines: string[] = [];
	let eventName: string | undefined;

	const reset = () => {
		dataLines = [];
		eventName = undefined;
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			while (true) {
				const nl = buffer.indexOf("\n");
				if (nl < 0) break;
				let line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (line.endsWith("\r")) line = line.slice(0, -1);

				if (line === "") {
					// End of event.
					if (dataLines.length > 0) {
						yield eventName !== undefined
							? { event: eventName, data: dataLines.join("\n") }
							: { data: dataLines.join("\n") };
					}
					reset();
					continue;
				}
				if (line.startsWith(":")) continue; // comment/keep-alive
				if (line.startsWith("data:")) {
					dataLines.push(line.slice(5).replace(/^ /, ""));
				} else if (line.startsWith("event:")) {
					eventName = line.slice(6).replace(/^ /, "");
				}
				// other fields (id:, retry:) are ignored for now
			}
		}
		// Flush a final event that has no trailing blank line.
		if (dataLines.length > 0) {
			yield eventName !== undefined
				? { event: eventName, data: dataLines.join("\n") }
				: { data: dataLines.join("\n") };
		}
	} finally {
		// If the consumer stops early (break/throw), propagate the cancellation to the upstream:
		// close the provider's body instead of leaving it open. On normal termination it is a no-op.
		// cancel() also releases the lock, so releaseLock() is not needed.
		await reader.cancel().catch(() => {});
	}
}
