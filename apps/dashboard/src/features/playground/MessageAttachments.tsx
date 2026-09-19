import { IconFileText } from "@tabler/icons-react";
import type { FileUIPart } from "ai";

import {
	DialogContent,
	DialogTrigger,
	DialogClose,
	DialogTitle,
	DialogRoot,
} from "#/components/ui/dialog";

export function MessageAttachments({
	files,
}: {
	files: (FileUIPart & { id: string })[];
}) {
	if (!files.length) {
		return null;
	}
	return (
		<div className="flex max-w-full flex-wrap justify-end gap-2">
			{files.map((file) => {
				const name = file.filename ?? "Attachment";
				return file.mediaType.startsWith("image/") &&
					file.url.startsWith("data:image/") ? (
					<DialogRoot key={file.id}>
						<DialogTrigger
							aria-label={`Preview ${name}`}
							className="size-36 overflow-hidden rounded-2xl border border-border p-0 sm:size-48"
						>
							{/* biome-ignore lint/performance/noImgElement: a data:/blob: attachment URL, which next/image has nothing to optimise */}
							<img
								alt={name}
								className="size-full object-cover"
								src={file.url}
							/>
						</DialogTrigger>
						<DialogContent className="md:w-3xl">
							<DialogTitle className="break-all">{name}</DialogTitle>
							{/* biome-ignore lint/performance/noImgElement: a data:/blob: attachment URL, which next/image has nothing to optimise */}
							<img
								alt={name}
								className="max-h-[70dvh] w-full object-contain"
								src={file.url}
							/>
							<DialogClose>Close preview</DialogClose>
						</DialogContent>
					</DialogRoot>
				) : (
					<div
						className="inline-flex h-16 max-w-56 items-center gap-3 rounded-2xl border border-border bg-surface-2 p-1.5 pr-2.5 text-left shadow-xs"
						key={file.id}
						title={name}
					>
						<div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-secondary-fg">
							<IconFileText aria-hidden size={20} />
						</div>
						<div className="flex h-full min-w-0 flex-col justify-between py-0.5">
							<span className="truncate font-medium text-xs">{name}</span>
							<span className="w-fit max-w-full truncate rounded-md border border-border px-1 py-0.5 text-fg-muted text-xs">
								{file.mediaType === "application/pdf"
									? "PDF"
									: file.mediaType.split("/")[0]}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}
