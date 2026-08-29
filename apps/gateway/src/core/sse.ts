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
	const processLine = (rawLine: string): SSEEvent | undefined => {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (line === "") {
			const event =
				dataLines.length === 0
					? undefined
					: eventName !== undefined
						? { event: eventName, data: dataLines.join("\n") }
						: { data: dataLines.join("\n") };
			reset();
			return event;
		}
		if (line.startsWith(":")) return undefined; // comment/keep-alive
		if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).replace(/^ /, ""));
		} else if (line.startsWith("event:")) {
			eventName = line.slice(6).replace(/^ /, "");
		}
		// other fields (id:, retry:) are ignored for now
		return undefined;
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			while (true) {
				const nl = buffer.indexOf("\n");
				if (nl < 0) break;
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				const event = processLine(line);
				if (event) yield event;
			}
		}
		buffer += decoder.decode();
		// Provider-tolerant extension: accept a final line/event without its SSE terminator.
		if (buffer.length > 0) {
			const event = processLine(buffer);
			if (event) yield event;
		}
		const finalEvent = processLine("");
		if (finalEvent) yield finalEvent;
	} finally {
		// If the consumer stops early (break/throw), propagate the cancellation to the upstream:
		// close the provider's body instead of leaving it open. On normal termination it is a no-op.
		// cancel() also releases the lock, so releaseLock() is not needed.
		await reader.cancel().catch(() => {});
	}
}
