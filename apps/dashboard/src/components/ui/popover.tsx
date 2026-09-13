"use client";

import { overlayButtonStyles, overlayArrowStyles } from "./dialog";
import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ComponentProps } from "react";

import {
	type AppearanceProps,
	mergeClassName,
	popupStyles,
	mergeStyle,
} from "./appearance";

export const PopoverRoot = BasePopover.Root;
export const PopoverHandle = BasePopover.Handle;
export const createPopoverHandle = BasePopover.createHandle;

export type PopoverTriggerProps<Payload = unknown> =
	BasePopover.Trigger.Props<Payload> & AppearanceProps;
export function PopoverTrigger<Payload = unknown>({
	className,
	style,
	borderRadius,
	width,
	...props
}: PopoverTriggerProps<Payload>) {
	return (
		<BasePopover.Trigger
			{...props}
			className={mergeClassName(overlayButtonStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PopoverPortalProps = ComponentProps<typeof BasePopover.Portal> &
	AppearanceProps;
export function PopoverPortal({
	className,
	style,
	borderRadius,
	width,
	...props
}: PopoverPortalProps) {
	return (
		<BasePopover.Portal
			{...props}
			className={mergeClassName("relative z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PopoverPositionerProps = ComponentProps<
	typeof BasePopover.Positioner
> &
	AppearanceProps;
export function PopoverPositioner({
	className,
	style,
	borderRadius,
	width,
	sideOffset = 8,
	// Against the viewport, not the document — see `select.tsx` for what `absolute` costs.
	positionMethod = "fixed",
	...props
}: PopoverPositionerProps) {
	return (
		<BasePopover.Positioner
			positionMethod={positionMethod}
			{...props}
			sideOffset={sideOffset}
			className={mergeClassName("z-50 outline-none", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PopoverPopupProps = ComponentProps<typeof BasePopover.Popup> &
	AppearanceProps;
export function PopoverPopup({
	className,
	style,
	borderRadius,
	width,
	...props
}: PopoverPopupProps) {
	return (
		<BasePopover.Popup
			{...props}
			className={mergeClassName(`${popupStyles} w-80 p-4`, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PopoverArrowProps = ComponentProps<typeof BasePopover.Arrow> &
	AppearanceProps;
export function PopoverArrow({
	className,
	style,
	borderRadius,
	width,
	...props
}: PopoverArrowProps) {
	return (
		<BasePopover.Arrow
			{...props}
			className={mergeClassName(overlayArrowStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PopoverBackdropProps = ComponentProps<typeof BasePopover.Backdrop> &
	AppearanceProps;
export function PopoverBackdrop({
	className,
	style,
	borderRadius,
	width,
	...props
}: PopoverBackdropProps) {
	return (
		<BasePopover.Backdrop
			{...props}
			className={mergeClassName("fixed inset-0 z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PopoverTitleProps = ComponentProps<typeof BasePopover.Title> &
	AppearanceProps;
export function PopoverTitle({
	className,
	style,
	borderRadius,
	width,
	...props
}: PopoverTitleProps) {
	return (
		<BasePopover.Title
			{...props}
			className={mergeClassName("text-sm font-semibold text-fg", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PopoverDescriptionProps = ComponentProps<
	typeof BasePopover.Description
> &
	AppearanceProps;
export function PopoverDescription({
	className,
	style,
	borderRadius,
	width,
	...props
}: PopoverDescriptionProps) {
	return (
		<BasePopover.Description
			{...props}
			className={mergeClassName("text-sm text-fg-muted", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PopoverCloseProps = ComponentProps<typeof BasePopover.Close> &
	AppearanceProps;
export function PopoverClose({
	className,
	style,
	borderRadius,
	width,
	...props
}: PopoverCloseProps) {
	return (
		<BasePopover.Close
			{...props}
			className={mergeClassName(overlayButtonStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PopoverViewportProps = ComponentProps<typeof BasePopover.Viewport> &
	AppearanceProps;
export function PopoverViewport({
	className,
	style,
	borderRadius,
	width,
	...props
}: PopoverViewportProps) {
	return (
		<BasePopover.Viewport
			{...props}
			className={mergeClassName(
				"relative flex min-w-0 flex-col gap-2",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PopoverContentProps = PopoverPopupProps & {
	portalProps?: PopoverPortalProps;
	positionerProps?: PopoverPositionerProps;
};
export function PopoverContent({
	portalProps,
	positionerProps,
	...props
}: PopoverContentProps) {
	return (
		<PopoverPortal {...portalProps}>
			<PopoverPositioner {...positionerProps}>
				<PopoverPopup {...props} />
			</PopoverPositioner>
		</PopoverPortal>
	);
}

export const Popover = PopoverContent;
export type PopoverProps = PopoverContentProps;
