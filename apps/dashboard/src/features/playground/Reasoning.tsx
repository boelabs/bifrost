import { IconCircleCheck } from "@tabler/icons-react";
import type { PlaygroundMessage } from "./transport";
import { useEffect, useState } from "react";
import { Markdown } from "./Markdown";

import {
	ChainOfThoughtContent,
	ChainOfThoughtHeader,
	ChainOfThoughtStep,
	ChainOfThought,
} from "#/shared/components/chain-of-thought";

type ReasoningPart = Extract<
	PlaygroundMessage["parts"][number],
	{ type: "reasoning" }
> & { key: string };

export function reasoningGroupAt(
	parts: PlaygroundMessage["parts"],
	index: number,
): ReasoningPart[] {
	for (let previous = index - 1; previous >= 0; previous--) {
		const part = parts[previous];
		if (part?.type === "step-start") continue;
		if (part?.type === "reasoning") return [];
		break;
	}
	const group: ReasoningPart[] = [];
	for (const [offset, part] of parts.slice(index).entries()) {
		if (part.type === "reasoning")
			group.push({ ...part, key: `reasoning-${index + offset}` });
		else if (part.type !== "step-start") break;
	}
	return group;
}

export function Reasoning({
	steps,
	streaming,
	hasFollowingText,
	interrupted = false,
}: {
	steps: ReasoningPart[];
	streaming: boolean;
	hasFollowingText: boolean;
	interrupted?: boolean;
}) {
	const completed = !interrupted && (!streaming || hasFollowingText);
	const [open, setOpen] = useState(!completed && !hasFollowingText);
	useEffect(() => {
		if (completed) setOpen(false);
	}, [completed]);
	if (!steps.length) return null;
	return (
		<ChainOfThought open={open} onOpenChange={setOpen}>
			<ChainOfThoughtHeader aria-label="Toggle reasoning">
				{completed
					? "Reasoning"
					: interrupted
						? "Reasoning interrupted"
						: "Thinking"}
			</ChainOfThoughtHeader>
			<ChainOfThoughtContent>
				<div className="space-y-4">
					{steps.map((step) => (
						<ChainOfThoughtStep
							key={step.key}
							status={
								streaming && step.state === "streaming" ? "active" : "complete"
							}
						>
							{step.text.trim() ? (
								<Markdown
									text={step.text}
									streaming={streaming && step.state === "streaming"}
								/>
							) : (
								<p className="text-fg-muted leading-7">
									{streaming && step.state === "streaming"
										? "Thinking..."
										: interrupted && step.state === "streaming"
											? "Reasoning was interrupted before text was returned."
											: "The model did not return reasoning text."}
								</p>
							)}
						</ChainOfThoughtStep>
					))}
					{completed && (
						<ChainOfThoughtStep icon={IconCircleCheck} label="Ready" />
					)}
				</div>
			</ChainOfThoughtContent>
		</ChainOfThought>
	);
}
