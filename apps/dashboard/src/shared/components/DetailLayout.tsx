import { cn } from "#/shared/lib/classes";
import type { ReactNode } from "react";

/**
 * A record page's body: its main content and, beside it, an aside of panels. They sit side by side
 * only when the content area itself fits both — measured with a container query, not the window,
 * because the sidebar takes part of the window and the aside needs about 20rem for its lists.
 */
export function DetailLayout({
	aside,
	spacing = "panels",
	children,
}: {
	aside: ReactNode;
	/** `sections`: the main column holds titled sections, further apart than panels. */
	spacing?: "panels" | "sections";
	children: ReactNode;
}) {
	return (
		<div className="@container">
			<div className="grid @min-[60rem]:grid-cols-3 gap-3">
				<div
					className={cn(
						"@min-[60rem]:col-span-2 flex min-w-0 flex-col",
						spacing === "sections" ? "gap-6" : "gap-3",
					)}
				>
					{children}
				</div>
				<div className="flex min-w-0 flex-col gap-3">{aside}</div>
			</div>
		</div>
	);
}
