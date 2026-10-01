import type { CSSProperties } from "react";
import { cn } from "#/shared/lib/classes";
import { tv } from "tailwind-variants";

export type UISize = "xs" | "sm" | "md" | "lg";
export type UIVariant = "outlined" | "filled" | "ghost";
export interface EffectProps {
	effect?: "3d" | null;
}

export function effectClassName(effect: EffectProps["effect"]) {
	return effect === "3d" ? "effect-3d" : "";
}
export type BorderRadius =
	| "none"
	| "sm"
	| "md"
	| "lg"
	| "xl"
	| "full"
	| CSSProperties["borderRadius"]
	| null;
export type UIWidth = "auto" | "full" | CSSProperties["width"] | null;

export interface AppearanceProps {
	borderRadius?: BorderRadius;
	width?: UIWidth;
}

export interface ControlProps extends AppearanceProps {
	size?: UISize;
	variant?: UIVariant;
}

const radii: Record<string, string> = {
	none: "0px",
	sm: "var(--ui-radius-sm)",
	md: "var(--ui-radius-md)",
	lg: "var(--ui-radius-lg)",
	xl: "var(--ui-radius-xl)",
	full: "9999px",
};

/** Null leaves sizing to the stylesheet; explicit style remains the final escape hatch. */
export function appearanceStyle(
	{ borderRadius, width }: AppearanceProps,
	style?: CSSProperties,
): CSSProperties {
	return {
		...(borderRadius == null
			? {}
			: {
					borderRadius:
						typeof borderRadius === "string"
							? (radii[borderRadius] ?? borderRadius)
							: borderRadius,
				}),
		...(width == null ? {} : { width: width === "full" ? "100%" : width }),
		...style,
	};
}

export function mergeClassName<State>(
	base: string,
	className?: string | ((state: State) => string | undefined),
) {
	return typeof className === "function"
		? (state: State) => cn(base, className(state))
		: cn(base, className);
}

export function mergeStyle<State>(
	appearance: AppearanceProps,
	style?: CSSProperties | ((state: State) => CSSProperties | undefined),
) {
	return typeof style === "function"
		? (state: State) => appearanceStyle(appearance, style(state))
		: appearanceStyle(appearance, style);
}

export const focusRing =
	"outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";
export const controlStyles = tv({
	base: "ui-control flex min-w-0 items-center gap-2 rounded-(--ui-radius-control) border text-base text-foreground shadow-xs/5 outline-none ring-ring/24 transition-shadow placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px] disabled:opacity-64 aria-invalid:border-destructive/36 data-focused:border-ring data-invalid:border-destructive/36 data-disabled:opacity-64 data-focused:ring-[3px] sm:text-sm",
	variants: {
		size: {
			xs: "min-h-7 px-[calc(--spacing(2)-1px)] py-1 sm:min-h-6",
			sm: "min-h-8 px-[calc(--spacing(2.5)-1px)] py-1 sm:min-h-7",
			md: "min-h-9 px-[calc(--spacing(3)-1px)] py-1 sm:min-h-8",
			lg: "min-h-10 px-[calc(--spacing(3)-1px)] py-1 sm:min-h-9",
		},
		variant: {
			outlined: "border-input bg-background dark:bg-input/32",
			filled: "border-input bg-background dark:bg-input/32",
			ghost: "border-transparent bg-transparent shadow-none hover:bg-accent",
		},
	},
	defaultVariants: { size: "md", variant: "outlined" },
});
export const overlayFadeStyles =
	"transition-opacity duration-200 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none";
export const popupStyles = `z-50 max-h-(--available-height) max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg/5 outline-none ${overlayFadeStyles}`;
export const itemStyles =
	"relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-base outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-64 sm:min-h-7 sm:text-sm";
export const labelStyles =
	"inline-flex items-center gap-2 font-medium text-base/4.5 text-foreground data-disabled:opacity-64 sm:text-sm/4";
export const descriptionStyles = "text-xs text-muted-foreground";
export const errorStyles = "text-xs text-destructive-foreground";
