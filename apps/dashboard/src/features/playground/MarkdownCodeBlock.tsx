import type { CodeLine, HighlightResult } from "./codeHighlight";
import { codeHighlightClient } from "./codeHighlightClient";

import {
	type ComponentProps,
	type CSSProperties,
	isValidElement,
	useContext,
	useEffect,
	useState,
	useRef,
	memo,
} from "react";

import {
	useIsCodeFenceIncomplete,
	CodeBlockContainer,
	StreamdownContext,
	CodeBlockHeader,
} from "streamdown";

const CodeRow = memo(function CodeRow({
	text,
	highlighted,
}: {
	text: string;
	highlighted?: CodeLine;
}) {
	const matching =
		highlighted &&
		text.startsWith(highlighted.text) &&
		highlighted.tokens.length;
	return (
		<span className="playground-code-line">
			{matching ? (
				<>
					{highlighted.tokens.map((token) => (
						<span
							key={token.offset}
							className="playground-code-token"
							style={
								{
									"--code-light": token.light,
									"--code-dark": token.dark,
									fontStyle: token.style,
									fontWeight: token.weight,
									textDecoration: token.decoration,
								} as CSSProperties
							}
						>
							{token.text}
						</span>
					))}
					{text.slice(highlighted.text.length)}
				</>
			) : (
				text || "\n"
			)}
		</span>
	);
});

export function HighlightedCode({
	code,
	language,
}: {
	code: string;
	language: string;
}) {
	const incomplete = useIsCodeFenceIncomplete();
	const { isAnimating } = useContext(StreamdownContext);
	const [result, setResult] = useState<HighlightResult>();
	const subscription =
		useRef<ReturnType<typeof codeHighlightClient.subscribe>>(undefined);
	const body = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	useEffect(() => {
		const client = codeHighlightClient.subscribe(setResult);
		subscription.current = client;
		return () => {
			client.release();
			subscription.current = undefined;
		};
	}, []);
	useEffect(() => {
		subscription.current?.update(code, language);
		const element = body.current;
		if (element && isAnimating && following.current)
			element.scrollTop = element.scrollHeight;
	}, [code, language, isAnimating]);
	const lines =
		result?.language === language && code.startsWith(result.code)
			? result.lines
			: undefined;
	const rows = code.split("\n").map((text, index) => ({
		number: index + 1,
		text,
		highlighted: lines?.[index],
	}));
	return (
		<CodeBlockContainer language={language} isIncomplete={incomplete} dir="ltr">
			<CodeBlockHeader language={language} />
			<div
				ref={body}
				data-streamdown="code-block-body"
				data-language={language}
				className="max-h-100 overflow-auto rounded-md border border-border bg-surface p-4 text-sm"
				onScroll={() => {
					const element = body.current;
					if (element)
						following.current =
							element.scrollHeight - element.scrollTop - element.clientHeight <
							8;
				}}
			>
				<pre>
					<code className="playground-code-lines">
						{rows.map((row) => (
							<CodeRow
								key={row.number}
								text={row.text}
								highlighted={row.highlighted}
							/>
						))}
					</code>
				</pre>
			</div>
		</CodeBlockContainer>
	);
}

export function MarkdownCodeBlock({ children }: ComponentProps<"pre">) {
	if (!isValidElement<{ children?: string; className?: string }>(children))
		return <pre>{children}</pre>;
	const language =
		/language-([^\s]+)/.exec(children.props.className ?? "")?.[1] ?? "text";
	const code = String(children.props.children ?? "")
		.replace(/\r\n?/g, "\n")
		.replace(/\n$/, "");
	return <HighlightedCode code={code} language={language} />;
}
