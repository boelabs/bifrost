import type { CSSProperties } from "react";
import { tv } from "tailwind-variants";
import { cn } from "cn";

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
	"outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
export const controlStyles = tv({
	base: "ui-control flex min-w-0 items-center gap-2 rounded-[var(--ui-radius-control)] border text-fg outline-none transition-[color,background-color,border-color,box-shadow] placeholder:text-fg-muted focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger data-[disabled]:cursor-not-allowed data-[focused]:border-focus data-[invalid]:border-danger data-[disabled]:opacity-50 data-[focused]:ring-2 data-[focused]:ring-focus/25",
	variants: {
		/**
		 * One step taller and wider than the kit shipped with. A 36px row of filters above a 20px
		 * corner reads as a toolbar bolted to a card; 40px, with the padding to match, reads as part
		 * of it. The steps stay in lockstep with `buttonStyles`, which is what keeps a button and the
		 * input beside it the same height.
		 */
		size: {
			xs: "min-h-8 px-2.5 py-1 text-xs",
			sm: "min-h-10 px-3.5 py-2 text-sm",
			md: "min-h-12 px-4 py-3 text-sm",
			lg: "min-h-14 px-5 py-3.5 text-base",
		},
		/**
		 * `filled` is the default: a control is a plane the operator writes on, not a rectangle drawn
		 * with a line. A form of outlined controls inside an outlined card spends the same border on
		 * two different jobs — separating regions and marking what is interactive — so neither reads
		 * as either. The border comes back only where it carries something: focus, and invalid.
		 */
		variant: {
			outlined: "border-border bg-surface hover:border-fg-muted/60",
			filled:
				"border-transparent bg-field placeholder:text-field-muted hover:bg-field-hover",
			ghost: "border-transparent bg-transparent hover:bg-field",
		},
	},
	defaultVariants: { size: "md", variant: "filled" },
});

export const overlayFadeStyles =
	"transition-opacity duration-150 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-reduce:transition-none";
export const popupStyles = `z-50 max-h-[var(--available-height)] max-w-[calc(100vw-2rem)] overflow-auto rounded-[var(--ui-radius-surface)] border border-border/60 bg-popover p-1.5 text-popover-foreground shadow-lg outline-none ${overlayFadeStyles}`;
export const itemStyles =
	"relative flex cursor-default items-center gap-2 rounded-[var(--ui-radius-item)] px-3 py-2.5 text-sm font-medium outline-none data-[highlighted]:bg-secondary data-[highlighted]:text-secondary-fg data-[disabled]:pointer-events-none data-[disabled]:text-fg-disabled";
export const labelStyles = "text-sm font-medium text-fg";
export const descriptionStyles = "text-sm text-fg-muted";
export const errorStyles = "text-sm text-danger";
