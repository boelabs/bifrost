import { Skeleton } from "#/shared/components/Skeleton.tsx";
import { NAVIGATION } from "./navigation.ts";

/** The groups the sidebar draws while the operator's role is read: same rows, same captions. */
export function NavSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading navigation"
			className="flex flex-col gap-4"
			role="status"
		>
			{NAVIGATION.map(({ label, items }) => (
				<div className="flex flex-col gap-0.5" key={label ?? "main"}>
					{label ? (
						<div className="px-2 pb-1 text-xs">
							<Skeleton className="h-4" width={`${label.length * 6}px`} />
						</div>
					) : null}
					{items.map((item) => (
						<div className="flex items-center gap-2 p-2" key={item.href}>
							<Skeleton className="size-4 shrink-0 rounded-md" />
							<Skeleton className="h-5" width={`${item.label.length * 7}px`} />
						</div>
					))}
				</div>
			))}
		</div>
	);
}

export function UserMenuSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading account"
			className="flex items-center gap-2 p-2"
			role="status"
		>
			<Skeleton className="size-6 shrink-0 rounded-full" />
			<Skeleton className="h-4" width="45%" />
		</div>
	);
}
