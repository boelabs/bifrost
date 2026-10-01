import { Skeleton } from "#/shared/components/Skeleton.tsx";
import { cn } from "cn";

const NAV_GROUPS = [
	{ label: null, items: ["Overview", "Metrics"] },
	{ label: "Gateway", items: ["Models", "API keys", "Playground", "Logs"] },
	{ label: "Administration", items: ["Extensions", "Users", "Audit"] },
];

export function NavSkeleton({
	collapsed,
	footer = false,
}: {
	collapsed: boolean;
	footer?: boolean;
}) {
	return (
		<div
			aria-busy="true"
			aria-label="Loading navigation"
			className="flex flex-col gap-4"
			role="status"
		>
			{(footer ? [{ label: null, items: ["Settings"] }] : NAV_GROUPS).map(
				({ label, items }) => (
					<div className="flex flex-col gap-0.5" key={label ?? "main"}>
						{!collapsed && label ? (
							<div className="px-2 pb-1 text-xs">
								<Skeleton className="h-4" width={`${label.length * 6}px`} />
							</div>
						) : null}
						{items.map((item) => (
							<div
								className={cn(
									"flex items-center gap-2 p-2",
									collapsed && "justify-center px-0",
								)}
								key={item}
							>
								<Skeleton className="size-4 shrink-0 rounded-md" />
								{collapsed ? null : (
									<Skeleton className="h-5" width={`${item.length * 7}px`} />
								)}
							</div>
						))}
					</div>
				),
			)}
		</div>
	);
}

export function UserMenuSkeleton({ collapsed }: { collapsed: boolean }) {
	return (
		<div
			aria-busy="true"
			aria-label="Loading account"
			className="flex size-9 items-center justify-center sm:size-8"
			role="status"
		>
			<Skeleton className="size-7 shrink-0 rounded-full" />
			{collapsed ? null : (
				<span className="min-w-0 flex-1">
					<Skeleton className="h-3.5" width="60%" />
					<Skeleton className="mt-1.5 h-3" width="40%" />
				</span>
			)}
		</div>
	);
}
