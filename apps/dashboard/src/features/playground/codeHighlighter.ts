import { bundledLanguages, createHighlighter, type GrammarState } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import type {
	HighlightRequest,
	HighlightReply,
	CodeLine,
} from "./codeHighlight";

type BlockState = {
	language: string;
	prefix: string;
	lineCount: number;
	grammar: GrammarState | undefined;
};

export async function createCodeHighlighter() {
	const highlighter = await createHighlighter({
		themes: ["github-light", "github-dark"],
		langs: [],
		engine: createJavaScriptRegexEngine({ forgiving: true }),
	});
	const blocks = new Map<number, BlockState>();
	return {
		async highlight(request: HighlightRequest): Promise<HighlightReply> {
			const requested = request.language.trim().toLowerCase();
			const language = Object.hasOwn(bundledLanguages, requested)
				? (requested as keyof typeof bundledLanguages)
				: "text";
			if (
				language !== "text" &&
				!highlighter.getLoadedLanguages().includes(language)
			) {
				await highlighter.loadLanguage(language);
			}
			let state = blocks.get(request.id);
			if (
				!state ||
				state.language !== language ||
				!request.code.startsWith(state.prefix)
			) {
				state = { language, prefix: "", lineCount: 0, grammar: undefined };
			}
			const startLine = state.lineCount;
			const tail = request.code.slice(state.prefix.length).split("\n");
			const lines: CodeLine[] = [];
			let prefixLength = state.prefix.length;
			for (const [index, text] of tail.entries()) {
				const result = highlighter.codeToTokens(text, {
					lang: language,
					themes: { light: "github-light", dark: "github-dark" },
					grammarState: state.grammar,
				});
				lines.push({
					text,
					tokens: (result.tokens[0] ?? []).map((token) => ({
						offset: token.offset,
						text: token.content,
						light: token.htmlStyle?.color ?? token.color,
						dark: token.htmlStyle?.["--shiki-dark"],
						style: token.htmlStyle?.["font-style"],
						weight: token.htmlStyle?.["font-weight"],
						decoration: token.htmlStyle?.["text-decoration"],
					})),
				});
				// Keep the state before the unfinished line so new tokens can change its grammar.
				if (index < tail.length - 1) {
					state.grammar = highlighter.getLastGrammarState(result.tokens);
					state.lineCount++;
					prefixLength += text.length + 1;
				}
			}
			state.prefix = request.code.slice(0, prefixLength);
			blocks.set(request.id, state);
			return { id: request.id, startLine, lines };
		},
		release(id: number) {
			blocks.delete(id);
		},
		dispose() {
			blocks.clear();
			highlighter.dispose();
		},
	};
}
