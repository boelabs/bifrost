"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { overlayArrowStyles } from "./dialog";
import type { ComponentProps } from "react";

import {
	type AppearanceProps,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance";

export const TooltipRoot = BaseTooltip.Root;
export const TooltipProvider = BaseTooltip.Provider;
export const TooltipHandle = BaseTooltip.Handle;
export const createTooltipHandle = BaseTooltip.createHandle;

export type TooltipTriggerProps<Payload = unknown> =
	BaseTooltip.Trigger.Props<Payload> & AppearanceProps;
export function TooltipTrigger<Payload = unknown>({
	className,
	style,
	borderRadius,
	width,
	...props
}: TooltipTriggerProps<Payload>) {
	return (
		<BaseTooltip.Trigger
			{...props}
			className={mergeClassName(
				`inline-flex items-center rounded-(--ui-radius-control) ${focusRing}`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type TooltipPortalProps = ComponentProps<typeof BaseTooltip.Portal> &
	AppearanceProps;
export function TooltipPortal({
	className,
	style,
	borderRadius,
	width,
	...props
}: TooltipPortalProps) {
	return (
		<BaseTooltip.Portal
			{...props}
			className={mergeClassName("relative z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type TooltipPositionerProps = ComponentProps<
	typeof BaseTooltip.Positioner
> &
	AppearanceProps;
export function TooltipPositioner({
	className,
	style,
	borderRadius,
	width,
	sideOffset = 8,
	// Against the viewport, not the document — see `select.tsx` for what `absolute` costs.
	positionMethod = "fixed",
	...props
}: TooltipPositionerProps) {
	return (
		<BaseTooltip.Positioner
			positionMethod={positionMethod}
			{...props}
			className={mergeClassName("z-50", className)}
			sideOffset={sideOffset}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type TooltipPopupProps = ComponentProps<typeof BaseTooltip.Popup> &
	AppearanceProps;
export function TooltipPopup({
	className,
	style,
	borderRadius,
	width,
	...props
}: TooltipPopupProps) {
	return (
		<BaseTooltip.Popup
			{...props}
			className={mergeClassName(
				"relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) text-balance rounded-md border bg-popover not-dark:bg-clip-padding px-2 py-1 text-popover-foreground text-xs shadow-md/5 transition-[width,height,scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0 motion-reduce:transition-none dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type TooltipArrowProps = ComponentProps<typeof BaseTooltip.Arrow> &
	AppearanceProps;
export function TooltipArrow({
	className,
	style,
	borderRadius,
	width,
	...props
}: TooltipArrowProps) {
	return (
		<BaseTooltip.Arrow
			{...props}
			className={mergeClassName(overlayArrowStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type TooltipViewportProps = ComponentProps<typeof BaseTooltip.Viewport> &
	AppearanceProps;
export function TooltipViewport({
	className,
	style,
	borderRadius,
	width,
	...props
}: TooltipViewportProps) {
	return (
		<BaseTooltip.Viewport
			{...props}
			className={mergeClassName("relative min-w-0", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type TooltipContentProps = TooltipPopupProps & {
	portalProps?: TooltipPortalProps;
	positionerProps?: TooltipPositionerProps;
};
export function TooltipContent({
	portalProps,
	positionerProps,
	...props
}: TooltipContentProps) {
	return (
		<TooltipPortal {...portalProps}>
			<TooltipPositioner {...positionerProps}>
				<TooltipPopup {...props} />
			</TooltipPositioner>
		</TooltipPortal>
	);
}

export const Tooltip = TooltipContent;
export type TooltipProps = TooltipContentProps;
