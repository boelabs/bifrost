"use client";

import type { ReactNode, RefObject } from "react";
import { ErrorNote } from "#/components/ui/page";

/**
 * The frame a capability's session is laid out in.
 *
 * The chat defined this shape and every other capability keeps it: a transcript that grows upward,
 * and a composer that sits in the middle of an empty session and at the foot of a busy one. Moving
 * between capabilities then moves the work, not the furniture.
 */
export function Workspace({
	scroll,
	empty,
	transcript,
	composer,
	error,
	title = "Playground",
	children,
}: {
	scroll: RefObject<HTMLDivElement | null>;
	empty: boolean;
	transcript: ReactNode;
	composer: ReactNode;
	/** What this workspace itself rejected — a bad attachment, an empty prompt. */
	error?: string;
	title?: string;
	/** Anything that renders outside the flow, such as the capability's settings dialog. */
	children?: ReactNode;
}) {
	return (
		<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
			<div
				ref={scroll}
				className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pt-6 [scrollbar-gutter:stable]"
			>
				{empty ? (
					<div className="flex h-full items-center justify-center px-4 pb-8 sm:hidden">
						<h2 className="text-center font-medium text-2xl tracking-tight">
							{title}
						</h2>
					</div>
				) : (
					<div className="mx-auto w-full space-y-10 pb-8 sm:max-w-2xl xl:max-w-3xl">
						{transcript}
					</div>
				)}
			</div>
			<div
				className={`relative mx-auto w-full shrink-0 px-2 pt-3 pb-2 sm:max-w-2xl sm:px-0 sm:pb-4 xl:max-w-3xl ${
					empty
						? "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:absolute sm:top-1/2 sm:left-1/2"
						: ""
				}`}
			>
				{empty ? (
					<h2 className="mb-6 hidden text-center font-medium text-3xl tracking-tight sm:block">
						{title}
					</h2>
				) : null}
				{error ? (
					<div className="mb-2 px-2 sm:px-0">
						<ErrorNote width="fit-content">{error}</ErrorNote>
					</div>
				) : null}
				{composer}
			</div>
			{children}
		</div>
	);
}
