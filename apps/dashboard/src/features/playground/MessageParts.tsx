import { IconCheck, IconChevronDown, IconCopy } from "@tabler/icons-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";

/**
 * The geometry every action under a message shares: a 40px touch target that tightens to 32px from
 * `lg`. One constant because the three of them sit in the same row — the details trigger is a
 * dialog trigger rather than a `Button`, so nothing else keeps them the same size.
 */
export const MESSAGE_ACTION = "size-10 rounded-xl text-fg-muted lg:size-8";
export const MESSAGE_ACTION_ICON = "size-5 lg:size-4.5";

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
		if (!copied) {
			return;
		}
		const timeout = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timeout);
	}, [copied]);
	return (
		<Button
			aria-label={copied ? "Copied" : label}
			className={MESSAGE_ACTION}
			disabled={disabled}
			mode="icon"
			onClick={async () => {
				try {
					await onCopy(text);
					setCopied(true);
				} catch {
					setCopied(false);
				}
			}}
			size="sm"
			title={copied ? "Copied" : label}
			variant="ghost"
		>
			{copied ? (
				<IconCheck aria-hidden className={MESSAGE_ACTION_ICON} />
			) : (
				<IconCopy aria-hidden className={MESSAGE_ACTION_ICON} />
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
		if (!element) {
			return;
		}
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
				className="wrap-break-word wrap-anywhere whitespace-pre-wrap"
				dir="auto"
				id={id}
				ref={paragraph}
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
					aria-controls={id}
					aria-expanded={expanded}
					aria-label={expanded ? "Collapse message" : "Expand message"}
					className="absolute right-2 bottom-2 size-7 bg-surface-2"
					mode="icon"
					onClick={() => setExpanded((value) => !value)}
					size="sm"
					variant="secondary"
				>
					<IconChevronDown
						aria-hidden
						className={expanded ? "rotate-180" : ""}
						size={18}
					/>
				</Button>
			) : null}
		</div>
	);
}
