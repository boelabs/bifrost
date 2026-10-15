import { cn } from "#/shared/lib/classes";
import type { ReactNode } from "react";

import {
	FrameDescription,
	FrameHeader,
	FrameTitle,
	FramePanel,
	Frame,
} from "#/components/ui/frame";

/**
 * A titled content block: the title, description and action sit in the muted tray, the content in
 * the panel inside it. Form sections, detail lists and tables that need a heading all use it.
 */
export function Panel({
	title,
	description,
	action,
	flush = false,
	className,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	/** Edge-to-edge content such as a table or a list: the panel drops its padding. */
	flush?: boolean;
	className?: string;
	children: ReactNode;
}) {
	return (
		<Frame className={cn("min-w-0", className)}>
			<FrameHeader className="flex-row items-center justify-between gap-4 py-3">
				<div className="flex min-w-0 flex-col">
					<FrameTitle>{title}</FrameTitle>
					{description ? (
						<FrameDescription>{description}</FrameDescription>
					) : null}
				</div>
				{action}
			</FrameHeader>
			<FramePanel className={cn(flush && "p-0")}>{children}</FramePanel>
		</Frame>
	);
}
