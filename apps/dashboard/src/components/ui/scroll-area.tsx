"use client";

import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";

import {
	type AppearanceProps,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance";

export type ScrollAreaRootProps = BaseScrollArea.Root.Props & AppearanceProps;
export type ScrollAreaViewportProps = BaseScrollArea.Viewport.Props &
	AppearanceProps;
export type ScrollAreaContentProps = BaseScrollArea.Content.Props &
	AppearanceProps;
export type ScrollAreaScrollbarProps = BaseScrollArea.Scrollbar.Props &
	AppearanceProps;
export type ScrollAreaThumbProps = BaseScrollArea.Thumb.Props & AppearanceProps;
export type ScrollAreaCornerProps = BaseScrollArea.Corner.Props &
	AppearanceProps;

export function ScrollAreaRoot({
	className,
	style,
	borderRadius,
	width,
	...props
}: ScrollAreaRootProps) {
	return (
		<BaseScrollArea.Root
			{...props}
			className={mergeClassName(
				"relative min-h-0 min-w-0 rounded-[var(--ui-radius-surface)]",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ScrollAreaViewport({
	className,
	style,
	borderRadius,
	width,
	...props
}: ScrollAreaViewportProps) {
	return (
		<BaseScrollArea.Viewport
			{...props}
			className={mergeClassName(
				`size-full overscroll-contain rounded-[inherit] ${focusRing}`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ScrollAreaContent({
	className,
	style,
	borderRadius,
	width,
	...props
}: ScrollAreaContentProps) {
	return (
		<BaseScrollArea.Content
			{...props}
			className={mergeClassName("min-w-full text-fg", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ScrollAreaScrollbar({
	className,
	style,
	borderRadius,
	width,
	...props
}: ScrollAreaScrollbarProps) {
	return (
		<BaseScrollArea.Scrollbar
			{...props}
			className={mergeClassName(
				"z-10 m-0.5 flex touch-none select-none rounded-full bg-surface-2/80 p-0.5 transition-opacity data-[orientation=horizontal]:h-3 data-[orientation=vertical]:w-3 data-[orientation=horizontal]:flex-col",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ScrollAreaThumb({
	className,
	style,
	borderRadius,
	width,
	...props
}: ScrollAreaThumbProps) {
	return (
		<BaseScrollArea.Thumb
			{...props}
			className={mergeClassName(
				"relative flex-1 rounded-full bg-fg-muted/50 transition-colors hover:bg-fg-muted active:bg-fg-muted data-[orientation=vertical]:min-h-5 data-[orientation=horizontal]:min-w-5",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ScrollAreaCorner({
	className,
	style,
	borderRadius,
	width,
	...props
}: ScrollAreaCornerProps) {
	return (
		<BaseScrollArea.Corner
			{...props}
			className={mergeClassName("rounded-[inherit] bg-surface-2", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export const ScrollArea = {
	Root: ScrollAreaRoot,
	Viewport: ScrollAreaViewport,
	Content: ScrollAreaContent,
	Scrollbar: ScrollAreaScrollbar,
	Thumb: ScrollAreaThumb,
	Corner: ScrollAreaCorner,
};
