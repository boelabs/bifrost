import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { DraftAttachment } from "./Composer";
import { Button } from "#/components/ui/button";

import {
	IconChevronRight,
	IconChevronLeft,
	IconFileText,
	IconX,
} from "@tabler/icons-react";

export function ComposerAttachments({
	files,
	onRemove,
}: {
	files: DraftAttachment[];
	onRemove: (id: string) => void;
}) {
	const track = useRef<HTMLDivElement>(null);
	const reduced = useReducedMotion();
	const [edges, setEdges] = useState({ left: false, right: false });
	useLayoutEffect(() => {
		const element = track.current;
		if (!(element && files.length)) {
			return;
		}
		const update = () =>
			setEdges({
				left: element.scrollLeft > 1,
				right:
					element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
			});
		const observer = new ResizeObserver(update);
		observer.observe(element);
		for (const child of element.children) {
			observer.observe(child);
		}
		element.addEventListener("scroll", update, { passive: true });
		update();
		return () => {
			observer.disconnect();
			element.removeEventListener("scroll", update);
		};
	}, [files]);
	function move(direction: number) {
		track.current?.scrollBy({
			left: direction * 240,
			behavior: reduced ? "instant" : "smooth",
		});
	}
	return (
		<div className="relative w-full">
			<section
				aria-label="Attachments"
				className="scrollbar-none flex w-full gap-2 overflow-x-auto overscroll-x-contain rounded-[20px] p-2 pb-1 md:p-3 md:pb-1"
				data-composer-attachments="true"
				ref={track}
			>
				<AnimatePresence initial={false} mode="popLayout">
					{files.map((file) => (
						<motion.div
							animate={{ opacity: 1 }}
							className="group/file-tile relative shrink-0"
							exit={{ opacity: 0 }}
							initial={{ opacity: 0 }}
							key={file.id}
							layout={reduced ? false : "position"}
							transition={{ duration: reduced ? 0 : 0.15 }}
						>
							{file.mediaType.startsWith("image/") ? (
								// biome-ignore lint/performance/noImgElement: a data:/blob: attachment URL, which next/image has nothing to optimise
								<img
									alt={file.filename ?? "Attached image"}
									className="h-30 w-auto min-w-24 max-w-38 rounded-2xl border border-border object-cover md:size-14 md:min-w-0 md:max-w-none md:rounded-[18px]"
									draggable={false}
									src={file.url}
								/>
							) : (
								<div className="flex size-30 flex-col items-start justify-between rounded-2xl border border-border bg-surface p-3 text-sm md:h-14 md:w-80 md:flex-row md:items-center md:justify-start md:gap-2 md:rounded-[18px] md:px-2.5 md:py-0">
									<IconFileText
										aria-hidden
										className="size-8 shrink-0 text-fg-muted md:m-2 md:size-6"
									/>
									<div className="min-w-0">
										<p className="line-clamp-2 break-all md:truncate md:font-semibold">
											{file.filename ?? "Attachment"}
										</p>
										<p className="hidden truncate text-fg-muted md:block">
											{file.mediaType}
										</p>
									</div>
								</div>
							)}
							<Button
								aria-label={`Remove ${file.filename ?? "attachment"}`}
								className="absolute top-1 right-1 z-20 size-6 bg-surface shadow-sm after:absolute after:-inset-2 md:top-1.25 md:right-1.25 md:size-4 md:translate-x-1/2 md:-translate-y-1/2 md:opacity-0 md:group-hover/file-tile:opacity-100 md:group-focus-within/file-tile:opacity-100"
								mode="icon"
								onClick={() => onRemove(file.id)}
								size="sm"
								type="button"
								variant="secondary"
							>
								<IconX
									aria-hidden
									className="size-4 md:size-3"
									strokeWidth={2.75}
								/>
							</Button>
						</motion.div>
					))}
				</AnimatePresence>
			</section>
			{edges.left ? (
				<Button
					aria-label="Previous attachments"
					className="absolute top-1/2 left-1 size-7 -translate-y-1/2 bg-surface shadow-sm"
					mode="icon"
					onClick={() => move(-1)}
					size="sm"
					type="button"
					variant="secondary"
				>
					<IconChevronLeft aria-hidden size={16} />
				</Button>
			) : null}
			{edges.right ? (
				<Button
					aria-label="Next attachments"
					className="absolute top-1/2 right-1 size-7 -translate-y-1/2 bg-surface shadow-sm"
					mode="icon"
					onClick={() => move(1)}
					size="sm"
					type="button"
					variant="secondary"
				>
					<IconChevronRight aria-hidden size={16} />
				</Button>
			) : null}
		</div>
	);
}
