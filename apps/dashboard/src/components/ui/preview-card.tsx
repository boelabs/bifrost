"use client";

import { PreviewCard as BasePreviewCard } from "@base-ui/react/preview-card";
import { overlayArrowStyles } from "./dialog";
import type { ComponentProps } from "react";

import {
	type AppearanceProps,
	mergeClassName,
	popupStyles,
	mergeStyle,
	focusRing,
} from "./appearance";

export const PreviewCardRoot = BasePreviewCard.Root;
export const PreviewCard = BasePreviewCard.Root;
export const PreviewCardHandle = BasePreviewCard.Handle;
export const createPreviewCardHandle = BasePreviewCard.createHandle;

export type PreviewCardTriggerProps<Payload = unknown> =
	BasePreviewCard.Trigger.Props<Payload> & AppearanceProps;
export function PreviewCardTrigger<Payload = unknown>({
	className,
	style,
	borderRadius,
	width,
	...props
}: PreviewCardTriggerProps<Payload>) {
	return (
		<BasePreviewCard.Trigger
			{...props}
			className={mergeClassName(
				`rounded-(--ui-radius-control) text-primary underline-offset-4 hover:underline ${focusRing}`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PreviewCardPortalProps = ComponentProps<
	typeof BasePreviewCard.Portal
> &
	AppearanceProps;
export function PreviewCardPortal({
	className,
	style,
	borderRadius,
	width,
	...props
}: PreviewCardPortalProps) {
	return (
		<BasePreviewCard.Portal
			{...props}
			className={mergeClassName("relative z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PreviewCardPositionerProps = ComponentProps<
	typeof BasePreviewCard.Positioner
> &
	AppearanceProps;
export function PreviewCardPositioner({
	className,
	style,
	borderRadius,
	width,
	sideOffset = 8,
	// Against the viewport, not the document — see `select.tsx` for what `absolute` costs.
	positionMethod = "fixed",
	...props
}: PreviewCardPositionerProps) {
	return (
		<BasePreviewCard.Positioner
			positionMethod={positionMethod}
			{...props}
			className={mergeClassName("z-50 outline-none", className)}
			sideOffset={sideOffset}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PreviewCardPopupProps = ComponentProps<
	typeof BasePreviewCard.Popup
> &
	AppearanceProps;
export function PreviewCardPopup({
	className,
	style,
	borderRadius,
	width,
	...props
}: PreviewCardPopupProps) {
	return (
		<BasePreviewCard.Popup
			{...props}
			className={mergeClassName(`${popupStyles} w-80 p-4`, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PreviewCardArrowProps = ComponentProps<
	typeof BasePreviewCard.Arrow
> &
	AppearanceProps;
export function PreviewCardArrow({
	className,
	style,
	borderRadius,
	width,
	...props
}: PreviewCardArrowProps) {
	return (
		<BasePreviewCard.Arrow
			{...props}
			className={mergeClassName(overlayArrowStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PreviewCardBackdropProps = ComponentProps<
	typeof BasePreviewCard.Backdrop
> &
	AppearanceProps;
export function PreviewCardBackdrop({
	className,
	style,
	borderRadius,
	width,
	...props
}: PreviewCardBackdropProps) {
	return (
		<BasePreviewCard.Backdrop
			{...props}
			className={mergeClassName("fixed inset-0 z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PreviewCardViewportProps = ComponentProps<
	typeof BasePreviewCard.Viewport
> &
	AppearanceProps;
export function PreviewCardViewport({
	className,
	style,
	borderRadius,
	width,
	...props
}: PreviewCardViewportProps) {
	return (
		<BasePreviewCard.Viewport
			{...props}
			className={mergeClassName(
				"relative flex min-w-0 flex-col gap-2",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type PreviewCardContentProps = PreviewCardPopupProps & {
	portalProps?: PreviewCardPortalProps;
	positionerProps?: PreviewCardPositionerProps;
};
export function PreviewCardContent({
	portalProps,
	positionerProps,
	...props
}: PreviewCardContentProps) {
	return (
		<PreviewCardPortal {...portalProps}>
			<PreviewCardPositioner {...positionerProps}>
				<PreviewCardPopup {...props} />
			</PreviewCardPositioner>
		</PreviewCardPortal>
	);
}
