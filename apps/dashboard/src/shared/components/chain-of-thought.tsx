"use client";

import type { ComponentProps, ReactNode } from "react";

import {
	CollapsibleTrigger,
	CollapsiblePanel,
	CollapsibleRoot,
} from "#/components/ui/collapsible";

import {
	IconChevronDown,
	type TablerIcon,
	IconBrain,
	IconPoint,
} from "@tabler/icons-react";

// Adapted from AI Elements Chain of Thought to the dashboard's Base UI primitives.
export function ChainOfThought({
	className = "",
	...props
}: ComponentProps<typeof CollapsibleRoot>) {
	return (
		<CollapsibleRoot
			className={"not-prose w-full space-y-4 " + className}
			{...props}
		/>
	);
}
export function ChainOfThoughtHeader({
	children,
	icon: Icon = IconBrain,
	...props
}: ComponentProps<typeof CollapsibleTrigger> & { icon?: TablerIcon }) {
	return (
		<CollapsibleTrigger
			className="flex h-auto w-full justify-start gap-2 px-0 py-1 font-normal text-fg-muted text-sm hover:text-fg data-[panel-open]:text-fg-muted"
			{...props}
		>
			<span aria-hidden>
				<Icon className="size-4" />
			</span>
			<span className="flex-1 text-left">{children ?? "Chain of Thought"}</span>
			<IconChevronDown
				aria-hidden
				className="size-4 motion-reduce:transition-none"
			/>
		</CollapsibleTrigger>
	);
}
export function ChainOfThoughtContent(
	props: ComponentProps<typeof CollapsiblePanel>,
) {
	return (
		<CollapsiblePanel
			keepMounted
			className="motion-reduce:transition-none"
			{...props}
		/>
	);
}
export function ChainOfThoughtStep({
	icon: Icon = IconPoint,
	label,
	status = "complete",
	children,
}: {
	icon?: TablerIcon;
	label?: ReactNode;
	status?: "complete" | "active" | "pending";
	children?: ReactNode;
}) {
	return (
		<div
			data-chain-step={status}
			className={
				"group/step relative flex gap-2 text-base " +
				(status === "active"
					? "text-fg"
					: status === "pending"
						? "text-fg-muted/50"
						: "text-fg-muted")
			}
		>
			<div className="relative mt-0.5 shrink-0">
				<Icon aria-hidden className="size-4" />
				<span
					aria-hidden
					className="absolute top-7 -bottom-4 left-1/2 w-px bg-border group-last/step:hidden"
				/>
			</div>
			<div className="min-w-0 flex-1 space-y-2">
				{label ? <div>{label}</div> : null}
				{children}
			</div>
		</div>
	);
}
