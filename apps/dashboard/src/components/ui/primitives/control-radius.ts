export const controlRadiusVariants = {
	default: "rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]",
	none: "rounded-none before:rounded-none",
	sm: "rounded-sm before:rounded-[calc(var(--radius-sm)-1px)]",
	md: "rounded-md before:rounded-[calc(var(--radius-md)-1px)]",
	lg: "rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]",
	xl: "rounded-xl before:rounded-[calc(var(--radius-xl)-1px)]",
	full: "rounded-full before:rounded-full",
} as const;
