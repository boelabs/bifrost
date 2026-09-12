import { IconCheck, IconChevronDown, IconCopy } from "@tabler/icons-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";

export function CopyAction({
	text,
	label,
	onCopy,
	disabled = false,
}: {
	text: string;
	label: string;
	onCopy: (text: string) => Promise<void>;
	disabled?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	useLayoutEffect(() => {
		if (!copied) return;
		const timeout = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timeout);
	}, [copied]);
	return (
		<Button
			disabled={disabled}
			variant="ghost"
			size="sm"
			mode="icon"
			className="size-10 rounded-xl text-fg-muted lg:size-8"
			aria-label={copied ? "Copied" : label}
			title={copied ? "Copied" : label}
			onClick={async () => {
				try {
					await onCopy(text);
					setCopied(true);
				} catch {
					setCopied(false);
				}
			}}
		>
			{copied ? (
				<IconCheck className="size-5 lg:size-4.5" aria-hidden />
			) : (
				<IconCopy className="size-5 lg:size-4.5" aria-hidden />
			)}
		</Button>
	);
}

export function UserBubble({
	text,
	hasAttachments,
}: {
	text: string;
	hasAttachments: boolean;
}) {
	const id = useId();
	const paragraph = useRef<HTMLParagraphElement>(null);
	const [expandable, setExpandable] = useState(false);
	const [expanded, setExpanded] = useState(false);
	useLayoutEffect(() => {
		const element = paragraph.current;
		if (!element) return;
		const measure = () => setExpandable(element.scrollHeight > 241);
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, []);
	return (
		<div
			className={`relative w-fit max-w-full overflow-hidden rounded-3xl border border-border/60 bg-surface-2 px-3.5 py-3 text-base leading-6 sm:py-2.5 ${hasAttachments ? "rounded-tr-lg" : ""} ${expandable ? "pr-10" : ""}`}
			style={{ maxHeight: expandable && !expanded ? 266 : undefined }}
		>
			<p
				id={id}
				ref={paragraph}
				dir="auto"
				className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
			>
				{text}
			</p>
			{expandable && !expanded ? (
				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-surface-2 to-transparent"
				/>
			) : null}
			{expandable ? (
				<Button
					variant="secondary"
					size="sm"
					mode="icon"
					className="absolute right-2 bottom-2 size-7 bg-surface-2"
					aria-label={expanded ? "Collapse message" : "Expand message"}
					aria-expanded={expanded}
					aria-controls={id}
					onClick={() => setExpanded((value) => !value)}
				>
					<IconChevronDown
						size={18}
						className={expanded ? "rotate-180" : ""}
						aria-hidden
					/>
				</Button>
			) : null}
		</div>
	);
}
