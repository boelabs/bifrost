import type { HighlightReply, HighlightRequest } from "./codeHighlight";
import { createCodeHighlighter } from "./codeHighlighter";

const highlighter = createCodeHighlighter();
let work = Promise.resolve();
self.onmessage = (
	event: MessageEvent<HighlightRequest | { release: number }>,
) => {
	const request = event.data;
	work = work.then(async () => {
		try {
			const engine = await highlighter;
			if ("release" in request) {
				engine.release(request.release);
			} else {
				self.postMessage(await engine.highlight(request));
			}
		} catch {
			if ("id" in request) {
				// A failed grammar must leave the current source visible.
				self.postMessage({
					id: request.id,
					startLine: 0,
					lines: request.code.split("\n").map((text) => ({ text, tokens: [] })),
				} satisfies HighlightReply);
				(await highlighter.catch(() => undefined))?.release(request.id);
			}
		}
	});
};
