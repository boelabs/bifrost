"use client";

import { overlayBackdropStyles, overlayButtonStyles } from "./dialog";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import type { ComponentProps } from "react";

import {
	type AppearanceProps,
	overlayFadeStyles,
	mergeClassName,
	mergeStyle,
} from "./appearance";

export const DrawerRoot = BaseDrawer.Root;
export const Drawer = BaseDrawer.Root;
export const DrawerProvider = BaseDrawer.Provider;
export const DrawerVirtualKeyboardProvider = BaseDrawer.VirtualKeyboardProvider;
export const DrawerHandle = BaseDrawer.Handle;
export const createDrawerHandle = BaseDrawer.createHandle;

export type DrawerTriggerProps<Payload = unknown> =
	BaseDrawer.Trigger.Props<Payload> & AppearanceProps;
export function DrawerTrigger<Payload = unknown>({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerTriggerProps<Payload>) {
	return (
		<BaseDrawer.Trigger
			{...props}
			className={mergeClassName(overlayButtonStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerPortalProps = ComponentProps<typeof BaseDrawer.Portal> &
	AppearanceProps;
export function DrawerPortal({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerPortalProps) {
	return (
		<BaseDrawer.Portal
			{...props}
			className={mergeClassName("relative z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerBackdropProps = ComponentProps<typeof BaseDrawer.Backdrop> &
	AppearanceProps;
export function DrawerBackdrop({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerBackdropProps) {
	return (
		<BaseDrawer.Backdrop
			{...props}
			className={mergeClassName(
				`${overlayBackdropStyles} opacity-[calc(1-var(--drawer-swipe-progress,0))]`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerViewportProps = ComponentProps<typeof BaseDrawer.Viewport> &
	AppearanceProps;
export function DrawerViewport({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerViewportProps) {
	return (
		<BaseDrawer.Viewport
			{...props}
			className={mergeClassName("fixed inset-0 z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerPopupProps = ComponentProps<typeof BaseDrawer.Popup> &
	AppearanceProps;
export function DrawerPopup({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerPopupProps) {
	return (
		<BaseDrawer.Popup
			{...props}
			className={mergeClassName(
				`${overlayFadeStyles} absolute flex max-h-[calc(100dvh-2rem)] max-w-full flex-col overflow-auto rounded-[var(--ui-radius-dialog)] border border-border/60 bg-surface text-fg shadow-xl outline-none transition-[transform,translate,opacity] data-[swiping]:select-none data-[swiping]:transition-none data-[swipe-direction=down]:inset-x-0 data-[swipe-direction=down]:bottom-0 data-[swipe-direction=up]:inset-x-0 data-[swipe-direction=up]:top-0 data-[swipe-direction=left]:inset-y-0 data-[swipe-direction=left]:left-0 data-[swipe-direction=left]:w-96 data-[swipe-direction=right]:inset-y-0 data-[swipe-direction=right]:right-0 data-[swipe-direction=right]:w-96 data-[swipe-direction=down]:data-[starting-style]:translate-y-full data-[swipe-direction=down]:data-[ending-style]:translate-y-full data-[swipe-direction=up]:data-[starting-style]:-translate-y-full data-[swipe-direction=up]:data-[ending-style]:-translate-y-full data-[swipe-direction=left]:data-[starting-style]:-translate-x-full data-[swipe-direction=left]:data-[ending-style]:-translate-x-full data-[swipe-direction=right]:data-[starting-style]:translate-x-full data-[swipe-direction=right]:data-[ending-style]:translate-x-full`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, (state) => ({
				transform: `translate(var(--drawer-swipe-movement-x, 0px), calc(var(--drawer-swipe-movement-y, 0px) + ${state.swipeDirection === "down" ? "var(--drawer-snap-point-offset, 0px)" : "0px"}))`,
				...(typeof style === "function" ? style(state) : style),
			}))}
		/>
	);
}

export type DrawerContentProps = ComponentProps<typeof BaseDrawer.Content> &
	AppearanceProps;
export function DrawerContent({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerContentProps) {
	return (
		<BaseDrawer.Content
			{...props}
			className={mergeClassName("flex min-h-0 flex-col gap-4 p-6", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerTitleProps = ComponentProps<typeof BaseDrawer.Title> &
	AppearanceProps;
export function DrawerTitle({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerTitleProps) {
	return (
		<BaseDrawer.Title
			{...props}
			className={mergeClassName("text-lg font-semibold text-fg", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerDescriptionProps = ComponentProps<
	typeof BaseDrawer.Description
> &
	AppearanceProps;
export function DrawerDescription({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerDescriptionProps) {
	return (
		<BaseDrawer.Description
			{...props}
			className={mergeClassName("text-sm text-fg-muted", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerCloseProps = ComponentProps<typeof BaseDrawer.Close> &
	AppearanceProps;
export function DrawerClose({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerCloseProps) {
	return (
		<BaseDrawer.Close
			{...props}
			className={mergeClassName(overlayButtonStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerIndentProps = ComponentProps<typeof BaseDrawer.Indent> &
	AppearanceProps;
export function DrawerIndent({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerIndentProps) {
	return (
		<BaseDrawer.Indent
			{...props}
			className={mergeClassName(
				"relative min-h-dvh rounded-[var(--ui-radius-surface)] bg-surface",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerIndentBackgroundProps = ComponentProps<
	typeof BaseDrawer.IndentBackground
> &
	AppearanceProps;
export function DrawerIndentBackground({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerIndentBackgroundProps) {
	return (
		<BaseDrawer.IndentBackground
			{...props}
			className={mergeClassName("fixed inset-0 -z-10 bg-surface-2", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerSwipeAreaProps = ComponentProps<typeof BaseDrawer.SwipeArea> &
	AppearanceProps;
export function DrawerSwipeArea({
	className,
	style,
	borderRadius,
	width,
	...props
}: DrawerSwipeAreaProps) {
	return (
		<BaseDrawer.SwipeArea
			{...props}
			className={mergeClassName(
				"relative rounded-[var(--ui-radius-control)] data-[disabled]:pointer-events-none",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DrawerOverlayProps = DrawerPopupProps & {
	portalProps?: DrawerPortalProps;
	backdropProps?: DrawerBackdropProps;
	viewportProps?: DrawerViewportProps;
	contentProps?: DrawerContentProps;
};
export function DrawerOverlay({
	portalProps,
	backdropProps,
	viewportProps,
	contentProps,
	children,
	...props
}: DrawerOverlayProps) {
	return (
		<DrawerPortal {...portalProps}>
			<DrawerBackdrop {...backdropProps} />
			<DrawerViewport {...viewportProps}>
				<DrawerPopup {...props}>
					<DrawerContent {...contentProps}>{children}</DrawerContent>
				</DrawerPopup>
			</DrawerViewport>
		</DrawerPortal>
	);
}
