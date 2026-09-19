"use client";

import type { ReactNode, RefObject } from "react";
import { ErrorNote } from "#/components/ui/page";
import { useEffect } from "react";

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
	/**
	 * The height the last turn reserves below itself, so a new answer starts at the top of the view
	 * instead of creeping up from the bottom. The chat sets the same variable; every transcript in
	 * the playground is laid out against it.
	 */
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
	}, [scroll]);

	return (
		<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
			<div
				// Bleeding into the shell's padding puts the scrollbar against the window edge, where a
				// scrollbar belongs; the padding is given back inside so the text stays where it was.
				className="scrollbar-gutter-stable -mr-4 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pt-6 pr-4 md:-mr-8 md:pr-8"
				ref={scroll}
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
						? "sm:absolute sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2"
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
