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
		<form
			aria-label="Message composer"
			onSubmit={onSend}
			className="relative isolate w-full"
			onDragEnter={(event) => {
				if (!event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				dragDepth.current++;
				setDragging(true);
			}}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("Files")) event.preventDefault();
			}}
			onDragLeave={(event) => {
				event.preventDefault();
				if (--dragDepth.current <= 0) setDragging(false);
			}}
			onDrop={(event) => {
				event.preventDefault();
				dragDepth.current = 0;
				setDragging(false);
				if (!reading && !busy) onFiles(Array.from(event.dataTransfer.files));
			}}
		>
			<input
				ref={input}
				type="file"
				multiple
				accept={accepted.join(",")}
				className="hidden"
				aria-label="Attach files"
				disabled={reading || busy || !accepted.length}
				onChange={(event) => {
					onFiles(Array.from(event.target.files ?? []));
					event.target.value = "";
				}}
			/>
			<ComposerView
				state={expanded ? "expanded" : "compact"}
				topSection={
					files.length ? (
						<ComposerAttachments files={files} onRemove={onRemove} />
					) : undefined
				}
				topSectionLayoutKey={files.map((file) => file.id).join(":")}
				onSurfaceClick={() => textarea.current?.focus()}
				textarea={
					<textarea
						ref={textarea}
						aria-label="Message"
						dir="auto"
						rows={1}
						value={prompt}
						readOnly={readOnly}
						style={{ height, overflowY }}
						placeholder={placeholder}
						className="mt-4 w-full min-w-0 resize-none bg-transparent pt-0 pb-4 align-bottom text-base font-normal leading-6.5 text-fg outline-none placeholder:truncate placeholder:text-fg-muted"
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
								if (!busy && !reading)
									event.currentTarget.form?.requestSubmit();
							}
						}}
						onPaste={(event) => {
							const pasted = Array.from(event.clipboardData.files);
							if (pasted.length) {
								event.preventDefault();
								if (!busy && !reading) onFiles(pasted);
							}
						}}
					/>
				}
				leftActions={
					showAttach ? (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							mode="icon"
							aria-label="Attach files"
							title={
								accepted.length
									? "Attach files"
									: "This model does not support attachments"
							}
							disabled={reading || busy || !accepted.length}
							onClick={() => input.current?.click()}
							className="hover:border-fg-muted max-sm:border-transparent max-sm:hover:border-transparent"
						>
							{reading ? (
								<IconLoader2
									size={20}
									className="animate-spin motion-reduce:animate-none"
									aria-hidden
								/>
							) : (
								<IconPlus size={20} strokeWidth={2.5} aria-hidden />
							)}
						</Button>
					) : null
				}
				rightActions={
					<>
						{modelPicker}
						<Button
							type="button"
							variant="ghost"
							size="sm"
							mode="icon"
							aria-label="Open model settings"
							title="Model settings"
							className="max-sm:border-border"
							onClick={onSettings}
						>
							<IconAdjustmentsHorizontal size={20} aria-hidden />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							mode="icon"
							aria-label="Reset conversation"
							title="Reset conversation"
							className="max-sm:border-border"
							onClick={onReset}
						>
							<IconRotate2 size={20} aria-hidden />
						</Button>
						<Button
							type={busy ? "button" : "submit"}
							size="sm"
							mode="icon"
							aria-label={busy ? "Stop response" : "Send message"}
							title={busy ? "Stop response" : "Send message"}
							className="hover:bg-primary active:bg-primary"
							disabled={
								!busy &&
								(reading ||
									!(canSend ?? (prompt.trim().length > 0 || files.length > 0)))
							}
							onClick={busy ? onStop : undefined}
						>
							{busy ? (
								<IconPlayerStop size={16} fill="currentColor" aria-hidden />
							) : (
								<IconArrowUp size={20} strokeWidth={2.5} aria-hidden />
							)}
						</Button>
					</>
				}
			/>
			{dragging ? (
				<div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[28px] border-2 border-dashed border-primary bg-surface-2/95 text-sm text-fg">
					{accepted.length
						? "Drop files here"
						: "This model does not support attachments"}
				</div>
			) : null}
			<span role="status" className="sr-only">
				{reading ? "Reading attachments" : ""}
			</span>
		</form>
	);
}
