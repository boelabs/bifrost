import { MessageAttachments } from "./MessageAttachments";
import { Reasoning, reasoningGroupAt } from "./Reasoning";
import {
	MESSAGE_ACTION_ICON,
	MESSAGE_ACTION,
	CopyAction,
	UserBubble,
} from "./MessageParts";
import type { PlaygroundMessage } from "./transport";
import { ResponseDetails } from "./ResponseDetails";
import { ResponseLoader } from "./ResponseLoader";
import { IconRotate2 } from "@tabler/icons-react";
import { Button } from "#/components/ui/button";
import { ErrorNote } from "#/components/ui/page";
import { Status } from "#/components/ui/status";
import { Markdown } from "./Markdown";

export function Conversation({
	messages,
	busy,
	error,
	onCopy,
	onRegenerate,
}: {
	messages: PlaygroundMessage[];
	busy: boolean;
	/**
	 * Why the last response failed, shown inside the turn it belongs to rather than as a bar across
	 * the page: the failure is that answer, and the message's own regenerate button is the retry.
	 */
	error?: string;
	onCopy: (text: string) => Promise<void>;
	onRegenerate: (messageId: string) => void;
}) {
	const displayMessages: PlaygroundMessage[] =
		busy && messages.at(-1)?.role !== "assistant"
			? [
					...messages,
					{
						id: "pending-response",
						role: "assistant",
						parts: [],
						metadata: { state: "streaming" },
					},
				]
			: messages;
	const groups = groupMessages(displayMessages);
	const isStreaming = (message: PlaygroundMessage) =>
		message.metadata?.state === "streaming" ||
		(busy && message.id === messages.at(-1)?.id);
	// A request that failed before the first chunk leaves no assistant turn to hang the note on.
	const failed = displayMessages.at(-1);
	const failedId =
		error && failed?.role === "assistant" ? failed.id : undefined;
	return (
		<div className="mx-auto w-full space-y-10 pb-8 sm:max-w-2xl xl:max-w-3xl">
			{groups.map((group) => (
				<section
					key={group[0].id}
					aria-label="Conversation turn"
					className="flex w-full flex-col gap-4 px-4 last:min-h-[calc(var(--transcript-height,0px)-3.5rem)]"
				>
					{group.map((message) => (
						<article
							key={message.id}
							aria-label={`${message.role === "user" ? "You" : "Assistant"} message`}
							className={
								message.role === "user"
									? "group/message ml-auto flex min-h-17 w-full max-w-[90%] flex-col items-end gap-1"
									: "group/message flex min-h-17 w-full min-w-0 flex-col gap-2"
							}
						>
							{message.metadata?.state === "stopped" ? (
								<div className="mb-1 text-fg-muted text-xs">
									<Status tone="muted">Stopped</Status>
								</div>
							) : null}
							{message.role === "user" ? (
								<MessageAttachments
									files={message.parts.flatMap((part, partIndex) =>
										part.type === "file"
											? [{ ...part, id: `${message.id}-file-${partIndex}` }]
											: [],
									)}
								/>
							) : null}
							{message.role === "assistant" &&
							isStreaming(message) &&
							!message.parts.some((part) =>
								part.type === "reasoning"
									? true
									: part.type === "text"
										? Boolean(part.text)
										: part.type === "file",
							) ? (
								<ResponseLoader />
							) : null}
							{message.parts.map((part, partIndex) => {
								if (part.type === "text" && !part.text) return null;
								const key = `${message.id}-${part.type}-${partIndex}`;
								if (part.type === "text")
									return message.role === "user" ? (
										<UserBubble
											key={key}
											text={part.text}
											hasAttachments={message.parts.some(
												(entry) => entry.type === "file",
											)}
										/>
									) : (
										<Markdown
											key={key}
											text={part.text}
											streaming={isStreaming(message)}
										/>
									);
								if (part.type === "reasoning") {
									const steps = reasoningGroupAt(message.parts, partIndex);
									if (!steps.length) return null;
									return (
										<Reasoning
											key={key}
											steps={steps}
											streaming={isStreaming(message)}
											hasFollowingText={message.parts
												.slice(partIndex + 1)
												.some(
													(entry) =>
														entry.type === "text" && Boolean(entry.text),
												)}
											interrupted={
												message.metadata?.state === "stopped" ||
												message.metadata?.state === "failed"
											}
										/>
									);
								}
								if (part.type === "file" && message.role !== "user")
									return (
										<div key={key} className="my-2">
											{part.mediaType.startsWith("image/") &&
											part.url.startsWith("data:image/") ? (
												// biome-ignore lint/performance/noImgElement: a data:/blob: attachment URL, which next/image has nothing to optimise
												<img
													src={part.url}
													alt={part.filename ?? "Attached image"}
													className="max-h-64 max-w-full rounded-lg object-contain"
												/>
											) : (
												<span className="break-all text-xs">
													Attachment: {part.filename ?? part.mediaType}
												</span>
											)}
										</div>
									);
								if (part.type === "source-url")
									return (
										<a
											key={key}
											href={
												/^https?:\/\//.test(part.url) ? part.url : undefined
											}
											target="_blank"
											rel="noopener noreferrer"
											className="block text-primary text-xs underline"
										>
											{part.title ?? part.url}
										</a>
									);
								return null;
							})}
							{message.role === "user" ? (
								<div className="flex w-fit self-end gap-1 px-2 opacity-100 transition-opacity lg:opacity-0 lg:group-focus-within/message:opacity-100 lg:group-hover/message:opacity-100">
									<CopyAction
										text={message.parts
											.filter((part) => part.type === "text")
											.map((part) => part.text)
											.join("\n")}
										label={
											message.role === "user" ? "Copy message" : "Copy response"
										}
										onCopy={onCopy}
									/>
								</div>
							) : null}
							{message.id === failedId ? (
								<ErrorNote width="fit-content">{error}</ErrorNote>
							) : null}
							{message.role === "assistant" ? (
								<div
									className={`-ml-2 mt-1 flex h-10 shrink-0 items-center gap-0.5 lg:h-8 ${isStreaming(message) ? "pointer-events-none" : ""}`}
								>
									<CopyAction
										text={message.parts
											.filter((part) => part.type === "text")
											.map((part) => part.text)
											.join("\n")}
										label="Copy response"
										disabled={isStreaming(message)}
										onCopy={onCopy}
									/>
									{
										<Button
											variant="ghost"
											size="sm"
											mode="icon"
											className={MESSAGE_ACTION}
											aria-label="Regenerate response"
											disabled={busy || isStreaming(message)}
											onClick={() => onRegenerate(message.id)}
										>
											<IconRotate2
												className={MESSAGE_ACTION_ICON}
												aria-hidden
											/>
										</Button>
									}
									<ResponseDetails
										metrics={message.metadata ?? {}}
										disabled={isStreaming(message) || !message.metadata}
									/>
								</div>
							) : null}
						</article>
					))}
				</section>
			))}
			{error && !failedId ? (
				<section aria-label="Conversation turn" className="px-4">
					<ErrorNote width="fit-content">{error}</ErrorNote>
				</section>
			) : null}
		</div>
	);
}

export function groupMessages(
	messages: PlaygroundMessage[],
): PlaygroundMessage[][] {
	const groups: PlaygroundMessage[][] = [];
	for (const message of messages) {
		if (message.role === "user" || !groups.length) groups.push([message]);
		else groups[groups.length - 1].push(message);
	}
	return groups;
}
