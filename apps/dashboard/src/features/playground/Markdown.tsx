import { Component, memo, type ComponentProps, type ReactNode } from "react";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { Block, Streamdown } from "streamdown";
import { math } from "@streamdown/math";

import {
	IconExternalLink,
	IconDownload,
	IconMaximize,
	IconLoader2,
	IconRotate2,
	IconZoomOut,
	IconZoomIn,
	IconCheck,
	IconCopy,
	IconX,
} from "@tabler/icons-react";

const plugins = { math };
const icons: ComponentProps<typeof Streamdown>["icons"] = {
	CheckIcon: IconCheck,
	CopyIcon: IconCopy,
	DownloadIcon: IconDownload,
	ExternalLinkIcon: IconExternalLink,
	Loader2Icon: IconLoader2,
	Maximize2Icon: IconMaximize,
	RotateCcwIcon: IconRotate2,
	XIcon: IconX,
	ZoomInIcon: IconZoomIn,
	ZoomOutIcon: IconZoomOut,
};

export class MarkdownBoundary extends Component<
	{ children: ReactNode; text: string },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		return this.state.failed ? (
			<div className="w-full min-w-0">
				<p className="mb-2 text-fg-muted text-xs" role="status">
					Formatting could not load. Showing the original text.
				</p>
				<pre className="wrap-break-word whitespace-pre-wrap font-mono text-sm">
					{this.props.text}
				</pre>
			</div>
		) : (
			this.props.children
		);
	}
}

function MarkdownBlock({ dir, ...props }: ComponentProps<typeof Block>) {
	if (!props.content?.trim()) {
		return null;
	}
	return (
		<div className="playground-markdown-block min-w-0" dir={dir}>
			<Block {...props} />
		</div>
	);
}
const components: ComponentProps<typeof Streamdown>["components"] = {
	pre: (props) => <MarkdownCodeBlock {...props} />,
	img: ({ alt }) => (
		<span className="text-fg-muted">[Image: {alt ?? "external image"}]</span>
	),
	a: ({ href, children }) => (
		<a
			className="text-primary underline underline-offset-2 hover:opacity-80"
			href={href}
			rel="noopener noreferrer"
			target="_blank"
		>
			{children}
		</a>
	),
};

export const Markdown = memo(function MarkdownBody({
	text,
	streaming = false,
}: {
	text: string;
	streaming?: boolean;
}) {
	return (
		<MarkdownBoundary text={text}>
			<Streamdown
				BlockComponent={MarkdownBlock}
				className="playground-markdown wrap-break-word w-full min-w-0 leading-7"
				components={components}
				controls={false}
				dir="auto"
				icons={icons}
				isAnimating={streaming}
				mode="streaming"
				plugins={plugins}
				skipHtml
			>
				{text}
			</Streamdown>
		</MarkdownBoundary>
	);
});
