import { Skeleton } from "#/shared/components/Skeleton.tsx";
import { cn } from "cn";

/**
 * What the sidebar shows while the gateway is still deciding who this operator is.
 *
 * Both shapes copy the classes of the real thing — the nav link's `min-h-10 … px-3 py-2` and the
 * user trigger's `gap-3 p-2` with its `size-8` avatar — so the sidebar is already the right height
 * and the right rhythm before any answer arrives.
 */

/** Eight rows: the role decides the real count (four for a viewer, ten for an owner). */
const NAV_ITEMS = 8;

export function NavSkeleton({ collapsed }: { collapsed: boolean }) {
	return (
		<div aria-busy="true" aria-label="Loading navigation" role="status">
			{Array.from({ length: NAV_ITEMS }, (_, index) => (
				<div
					className={cn(
						"flex min-h-10 items-center gap-3 px-3 py-2",
						collapsed && "justify-center px-0",
					)}
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
					key={index}
				>
					<Skeleton className="size-4.5 shrink-0 rounded-md" />
					{collapsed ? null : (
						<Skeleton
							className="h-3.5"
							width={`${[64, 56, 60, 72, 80, 48, 84, 64][index] ?? 64}px`}
						/>
					)}
				</div>
			))}
		</div>
	);
}

export function UserMenuSkeleton({ collapsed }: { collapsed: boolean }) {
	return (
		<div
			aria-busy="true"
			aria-label="Loading account"
			className="flex w-full items-center gap-3 p-2"
			role="status"
		>
			<Skeleton className="size-8 shrink-0 rounded-[var(--ui-radius-control)]" />
			{collapsed ? null : (
				<span className="min-w-0 flex-1">
					<Skeleton className="h-3.5" width="60%" />
					<Skeleton className="mt-1.5 h-3" width="40%" />
				</span>
			)}
		</div>
	);
}
