import { useComposerTextarea } from "./useComposerTextarea";
import { ComposerAttachments } from "./ComposerAttachments";
import { type ReactNode, useRef, useState } from "react";
import { useMobileComposer } from "./useMobileComposer";
import { Button } from "#/components/ui/button";
import { ComposerView } from "./ComposerView";
import type { FileUIPart } from "ai";

import {
	IconAdjustmentsHorizontal,
	IconPlayerStop,
	IconLoader2,
	IconRotate2,
	IconArrowUp,
	IconPlus,
} from "@tabler/icons-react";

export type DraftAttachment = FileUIPart & { id: string };

export function Composer({
	prompt,
	onPrompt,
	files,
	onRemove,
	onFiles,
	accepted,
	reading,
	busy,
	onSend,
	onStop,
	onSettings,
	onReset,
	modelPicker,
	placeholder = "Write a message...",
	showAttach = true,
	readOnly = false,
	canSend,
}: {
	prompt: string;
	onPrompt: (value: string) => void;
	files: DraftAttachment[];
	onRemove: (id: string) => void;
	onFiles: (files: File[]) => void;
	accepted: string[];
	reading: boolean;
	busy: boolean;
	onSend: (event: React.FormEvent<HTMLFormElement>) => void;
	onStop: () => void;
	onSettings: () => void;
	onReset: () => void;
	/**
	 * The model this message will be sent to, picked here rather than in a header bar: it is part of
	 * writing the message, and it is the thing an operator changes most often.
	 */
	modelPicker?: ReactNode;
	/** What this capability is asking for — a message, a prompt, a query. */
	placeholder?: string;
	/**
	 * Whether attaching is a thing this capability can do at all. A chat model that happens to take
	 * no images still shows the clip, disabled, because another model would; embedding a file is not
	 * a thing anywhere, and a permanently dead button is worse than none.
	 */
	showAttach?: boolean;
	/** For a capability whose request is a file: there is nothing to type into the box. */
	readOnly?: boolean;
	/** Overrides "there is a draft" as the test for whether this composer can be sent. */
	canSend?: boolean;
}) {
	const input = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const dragDepth = useRef(0);
	const mobile = useMobileComposer();
	const { textarea, expanded, height, overflowY } = useComposerTextarea(
		prompt,
		mobile,
	);
	return (
		// biome-ignore lint/a11y/noNoninteractiveElementInteractions: what the rule sees here is the drop target, not onSubmit (a plain `<form onSubmit>` passes) — and a drop target has no interactive role to give it. The keyboard path to the same thing is the attach button's file input below.
		<form
			aria-label="Message composer"
			className="relative isolate w-full"
			onDragEnter={(event) => {
				if (!event.dataTransfer.types.includes("Files")) {
					return;
				}
				event.preventDefault();
				dragDepth.current++;
				setDragging(true);
			}}
			onDragLeave={(event) => {
				event.preventDefault();
				if (--dragDepth.current <= 0) {
					setDragging(false);
				}
			}}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("Files")) {
					event.preventDefault();
				}
			}}
			onDrop={(event) => {
				event.preventDefault();
				dragDepth.current = 0;
				setDragging(false);
				if (!(reading || busy)) {
					onFiles(Array.from(event.dataTransfer.files));
				}
			}}
			onSubmit={onSend}
		>
			<input
				accept={accepted.join(",")}
				aria-label="Attach files"
				className="hidden"
				disabled={reading || busy || !accepted.length}
				multiple
				onChange={(event) => {
					onFiles(Array.from(event.target.files ?? []));
					event.target.value = "";
				}}
				ref={input}
				type="file"
			/>
			<ComposerView
				leftActions={
					showAttach ? (
						<Button
							aria-label="Attach files"
							className="hover:border-fg-muted max-sm:border-transparent max-sm:hover:border-transparent"
							disabled={reading || busy || !accepted.length}
							mode="icon"
							onClick={() => input.current?.click()}
							size="sm"
							title={
								accepted.length
									? "Attach files"
									: "This model does not support attachments"
							}
							type="button"
							variant="secondary"
						>
							{reading ? (
								<IconLoader2
									aria-hidden
									className="animate-spin motion-reduce:animate-none"
									size={20}
								/>
							) : (
								<IconPlus aria-hidden size={20} strokeWidth={2.5} />
							)}
						</Button>
					) : null
				}
				onSurfaceClick={() => textarea.current?.focus()}
				rightActions={
					<>
						{modelPicker}
						<Button
							aria-label="Open model settings"
							className="max-sm:border-border"
							mode="icon"
							onClick={onSettings}
							size="sm"
							title="Model settings"
							type="button"
							variant="ghost"
						>
							<IconAdjustmentsHorizontal aria-hidden size={20} />
						</Button>
						<Button
							aria-label="Reset conversation"
							className="max-sm:border-border"
							mode="icon"
							onClick={onReset}
							size="sm"
							title="Reset conversation"
							type="button"
							variant="ghost"
						>
							<IconRotate2 aria-hidden size={20} />
						</Button>
						<Button
							aria-label={busy ? "Stop response" : "Send message"}
							className="hover:bg-primary active:bg-primary"
							disabled={
								!busy &&
								(reading ||
									!(canSend ?? (prompt.trim().length > 0 || files.length > 0)))
							}
							mode="icon"
							onClick={busy ? onStop : undefined}
							size="sm"
							title={busy ? "Stop response" : "Send message"}
							type={busy ? "button" : "submit"}
						>
							{busy ? (
								<IconPlayerStop aria-hidden fill="currentColor" size={16} />
							) : (
								<IconArrowUp aria-hidden size={20} strokeWidth={2.5} />
							)}
						</Button>
					</>
				}
				state={expanded ? "expanded" : "compact"}
				textarea={
					<textarea
						aria-label="Message"
						className="mt-4 w-full min-w-0 resize-none bg-transparent pt-0 pb-4 align-bottom font-normal text-base text-fg leading-6.5 outline-none placeholder:truncate placeholder:text-fg-muted"
						dir="auto"
						onChange={(event) => onPrompt(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								!event.shiftKey &&
								!event.nativeEvent.isComposing &&
								event.keyCode !== 229 &&
								!mobile
							) {
								event.preventDefault();
								if (!(busy || reading)) {
									event.currentTarget.form?.requestSubmit();
								}
							}
						}}
						onPaste={(event) => {
							const pasted = Array.from(event.clipboardData.files);
							if (pasted.length) {
								event.preventDefault();
								if (!(busy || reading)) {
									onFiles(pasted);
								}
							}
						}}
						placeholder={placeholder}
						readOnly={readOnly}
						ref={textarea}
						rows={1}
						style={{ height, overflowY }}
						value={prompt}
					/>
				}
				topSection={
					files.length ? (
						<ComposerAttachments files={files} onRemove={onRemove} />
					) : undefined
				}
				topSectionLayoutKey={files.map((file) => file.id).join(":")}
			/>
			{dragging ? (
				<div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[28px] border-2 border-primary border-dashed bg-surface-2/95 text-fg text-sm">
					{accepted.length
						? "Drop files here"
						: "This model does not support attachments"}
				</div>
			) : null}
			<span className="sr-only" role="status">
				{reading ? "Reading attachments" : ""}
			</span>
		</form>
	);
}
