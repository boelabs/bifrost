import { createPlaygroundTransport, type PlaygroundMessage } from "./transport";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { attachmentTypes, readAttachments } from "./attachments";
import type { PlaygroundSettings, PublicEndpoint } from "./api";
import { IconArrowDown } from "@tabler/icons-react";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Conversation } from "./Conversation";
import { useChat } from "@ai-sdk/react";
import { Composer } from "./Composer";
import type { FileUIPart } from "ai";

export function ChatSession({
	endpoint,
	modelId,
	modalities,
	settings,
	onSettings,
	onReset,
	modelPicker,
}: {
	endpoint: PublicEndpoint;
	modelId: string;
	modalities: string[];
	settings: PlaygroundSettings;
	onSettings: () => void;
	onReset: () => void;
	modelPicker?: ReactNode;
}) {
	const [prompt, setPrompt] = useState("");
	const [files, setFiles] = useState<(FileUIPart & { id: string })[]>([]);
	const [reading, setReading] = useState(false);
	const [localError, setLocalError] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const alive = useRef(true);
	const [showScrollDown, setShowScrollDown] = useState(false);
	const scroll = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const startedAt = useRef<number>(0);
	const accepted = attachmentTypes(modalities, endpoint);
	const {
		messages,
		sendMessage,
		regenerate,
		stop,
		clearError,
		error,
		status,
		setMessages,
	} = useChat<PlaygroundMessage>({
		transport: createPlaygroundTransport(endpoint, modelId, settings),
		throttle: 40,
		onFinish: ({ isAbort, isError }) => {
			if (alive.current && (isAbort || isError)) {
				setMessages((current) =>
					current.map((message, index) =>
						index === current.length - 1 && message.role === "assistant"
							? {
									...message,
									metadata: {
										...message.metadata,
										durationMs: performance.now() - startedAt.current,
										state: isAbort ? "stopped" : "failed",
									},
								}
							: message,
					),
				);
			}
		},
	});
	const busy = status === "submitted" || status === "streaming";

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			void stop();
		};
	}, [stop]);

	useEffect(() => {
		if (messages.length && follow.current && scroll.current) {
			scroll.current.scrollTop = scroll.current.scrollHeight;
		}
	}, [messages]);

	useEffect(() => {
		const area = scroll.current;
		if (!area) {
			return;
		}
		const resize = new ResizeObserver(() => {
			area.style.setProperty("--transcript-height", `${area.clientHeight}px`);
		});
		resize.observe(area);
		return () => resize.disconnect();
	}, []);

	async function addFiles(selected: File[]) {
		setLocalError(undefined);
		setReading(true);
		try {
			const attachments = await readAttachments(selected, accepted);
			if (alive.current) {
				setFiles((current) => [
					...current,
					...attachments.map((file) => ({ ...file, id: crypto.randomUUID() })),
				]);
			}
		} catch (cause) {
			if (alive.current) {
				setLocalError(
					cause instanceof Error
						? cause.message
						: "Could not read attachments.",
				);
			}
		} finally {
			if (alive.current) {
				setReading(false);
			}
		}
	}

	async function send(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || reading) {
			setLocalError("Wait for the current operation to finish before sending.");
			return;
		}
		if (!(prompt.trim() || files.length)) {
			setLocalError("Enter a message or attach a supported file.");
			return;
		}
		setLocalError(undefined);
		setNotice(undefined);
		clearError();
		follow.current = true;
		const message = { text: prompt.trim(), files };
		setPrompt("");
		setFiles([]);
		startedAt.current = performance.now();
		await sendMessage(message);
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setNotice("Copied to clipboard.");
		} catch (cause) {
			setLocalError(
				cause instanceof Error ? cause.message : "Could not copy the response.",
			);
			throw cause;
		}
	}

	return (
		<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
			<div
				// Bleeding into the shell's padding puts the scrollbar against the window edge, where a
				// scrollbar belongs; the padding is given back inside so the text stays where it was.
				className="scrollbar-gutter-stable -mr-4 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pt-6 pr-4 md:-mr-8 md:pr-8"
				onScroll={() => {
					const area = scroll.current;
					if (area) {
						follow.current =
							area.scrollHeight - area.scrollTop - area.clientHeight < 80;
					}
					setShowScrollDown(!follow.current);
				}}
				ref={scroll}
			>
				{messages.length ? (
					<Conversation
						busy={busy}
						error={error?.message}
						messages={messages}
						onCopy={copy}
						onRegenerate={(messageId) => {
							clearError();
							follow.current = true;
							startedAt.current = performance.now();
							void regenerate({ messageId });
						}}
					/>
				) : (
					<div className="flex h-full items-center justify-center px-4 pb-8 sm:hidden">
						<h2 className="text-center font-medium text-2xl tracking-tight sm:text-3xl">
							Playground
						</h2>
					</div>
				)}
			</div>
			{notice ? (
				<p className="sr-only" role="status">
					{notice}
				</p>
			) : null}{" "}
			<div
				className={`relative mx-auto w-full shrink-0 px-2 pt-3 pb-2 sm:max-w-2xl sm:px-0 sm:pb-4 xl:max-w-3xl ${messages.length ? "" : "sm:absolute sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2"}`}
			>
				{showScrollDown ? (
					<Button
						aria-label="Scroll to latest message"
						className="absolute -top-11 left-1/2 -translate-x-1/2 bg-surface shadow-sm"
						mode="icon"
						onClick={() => {
							follow.current = true;
							scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
							setShowScrollDown(false);
						}}
						size="sm"
						variant="secondary"
					>
						<IconArrowDown aria-hidden size={18} />
					</Button>
				) : null}
				{messages.length ? null : (
					<h2 className="mb-6 hidden text-center font-medium text-3xl tracking-tight sm:block">
						Playground
					</h2>
				)}
				{/**
				 * Only the composer's own complaints belong here — a rejected attachment, an empty
				 * send. A failed response is shown inside its turn, next to the regenerate button
				 * that retries it; and when the failure left no turn behind, this is where it lands.
				 */}
				{localError || (error && !messages.length) ? (
					<div className="mb-2 px-2 sm:px-0">
						<ErrorNote width="fit-content">
							{localError ?? error?.message}
						</ErrorNote>
					</div>
				) : null}
				<Composer
					accepted={accepted}
					busy={busy}
					files={files}
					modelPicker={modelPicker}
					onFiles={(selected) => {
						void addFiles(selected);
					}}
					onPrompt={setPrompt}
					onRemove={(id) =>
						setFiles((current) => current.filter((file) => file.id !== id))
					}
					onReset={onReset}
					onSend={send}
					onSettings={onSettings}
					onStop={() => {
						void stop();
					}}
					prompt={prompt}
					reading={reading}
				/>
			</div>
		</div>
	);
}
