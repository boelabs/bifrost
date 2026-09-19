export interface CodeToken {
	offset: number;
	text: string;
	light?: string;
	dark?: string;
	style?: string;
	weight?: string;
	decoration?: string;
}

export interface CodeLine {
	text: string;
	tokens: CodeToken[];
}
export interface HighlightRequest {
	id: number;
	code: string;
	language: string;
}
export interface HighlightReply {
	id: number;
	startLine: number;
	lines: CodeLine[];
}
export type HighlightResult = HighlightRequest & { lines: CodeLine[] };

export function applyHighlight(
	previous: HighlightResult | undefined,
	request: HighlightRequest,
	reply: HighlightReply,
): HighlightResult {
	return {
		...request,
		lines: [
			...(previous?.lines.slice(0, reply.startLine) ?? []),
			...reply.lines,
		],
	};
}
