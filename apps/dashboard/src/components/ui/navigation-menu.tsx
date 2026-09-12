"use client";

import { NavigationMenu as BaseNavigationMenu } from "@base-ui/react/navigation-menu";
import { overlayButtonStyles, overlayArrowStyles } from "./dialog";
import type { ComponentProps } from "react";

import {
	type AppearanceProps,
	overlayFadeStyles,
	mergeClassName,
	popupStyles,
	mergeStyle,
	focusRing,
} from "./appearance";

export type NavigationMenuRootProps = ComponentProps<
	typeof BaseNavigationMenu.Root
> &
	AppearanceProps;
export function NavigationMenuRoot({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuRootProps) {
	return (
		<BaseNavigationMenu.Root
			{...props}
			className={mergeClassName(
				"relative rounded-[var(--ui-radius-control)] text-fg",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuListProps = ComponentProps<
	typeof BaseNavigationMenu.List
> &
	AppearanceProps;
export function NavigationMenuList({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuListProps) {
	return (
		<BaseNavigationMenu.List
			{...props}
			className={mergeClassName(
				"m-0 flex list-none items-center gap-1 p-0",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuItemProps = ComponentProps<
	typeof BaseNavigationMenu.Item
> &
	AppearanceProps;
export function NavigationMenuItem({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuItemProps) {
	return (
		<BaseNavigationMenu.Item
			{...props}
			className={mergeClassName("relative", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuContentProps = ComponentProps<
	typeof BaseNavigationMenu.Content
> &
	AppearanceProps;
export function NavigationMenuContent({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuContentProps) {
	return (
		<BaseNavigationMenu.Content
			{...props}
			className={mergeClassName(
				`min-w-56 p-4 outline-none ${overlayFadeStyles}`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuTriggerProps = ComponentProps<
	typeof BaseNavigationMenu.Trigger
> &
	AppearanceProps;
export function NavigationMenuTrigger({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuTriggerProps) {
	return (
		<BaseNavigationMenu.Trigger
			{...props}
			className={mergeClassName(
				`${overlayButtonStyles} data-[popup-open]:bg-secondary`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuPortalProps = ComponentProps<
	typeof BaseNavigationMenu.Portal
> &
	AppearanceProps;
export function NavigationMenuPortal({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuPortalProps) {
	return (
		<BaseNavigationMenu.Portal
			{...props}
			className={mergeClassName("relative z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuPositionerProps = ComponentProps<
	typeof BaseNavigationMenu.Positioner
> &
	AppearanceProps;
export function NavigationMenuPositioner({
	className,
	style,
	borderRadius,
	width,
	sideOffset = 8,
	...props
}: NavigationMenuPositionerProps) {
	return (
		<BaseNavigationMenu.Positioner
			{...props}
			sideOffset={sideOffset}
			className={mergeClassName("z-50 outline-none", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuViewportProps = ComponentProps<
	typeof BaseNavigationMenu.Viewport
> &
	AppearanceProps;
export function NavigationMenuViewport({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuViewportProps) {
	return (
		<BaseNavigationMenu.Viewport
			{...props}
			className={mergeClassName(
				"relative size-full overflow-hidden",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuBackdropProps = ComponentProps<
	typeof BaseNavigationMenu.Backdrop
> &
	AppearanceProps;
export function NavigationMenuBackdrop({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuBackdropProps) {
	return (
		<BaseNavigationMenu.Backdrop
			{...props}
			className={mergeClassName("fixed inset-0 z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuPopupProps = ComponentProps<
	typeof BaseNavigationMenu.Popup
> &
	AppearanceProps;
export function NavigationMenuPopup({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuPopupProps) {
	return (
		<BaseNavigationMenu.Popup
			{...props}
			className={mergeClassName(
				`${popupStyles} h-[var(--popup-height)] w-[var(--popup-width)] p-0`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuArrowProps = ComponentProps<
	typeof BaseNavigationMenu.Arrow
> &
	AppearanceProps;
export function NavigationMenuArrow({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuArrowProps) {
	return (
		<BaseNavigationMenu.Arrow
			{...props}
			className={mergeClassName(overlayArrowStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuLinkProps = ComponentProps<
	typeof BaseNavigationMenu.Link
> &
	AppearanceProps;
export function NavigationMenuLink({
	className,
	style,
	borderRadius,
	width,
	...props
}: NavigationMenuLinkProps) {
	return (
		<BaseNavigationMenu.Link
			{...props}
			className={mergeClassName(
				`block rounded-[var(--ui-radius-item)] px-3 py-2 text-sm hover:bg-secondary data-[active]:bg-secondary data-[active]:text-primary ${focusRing}`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type NavigationMenuIconProps = ComponentProps<
	typeof BaseNavigationMenu.Icon
> &
	AppearanceProps;
export function NavigationMenuIcon({
	className,
	style,
	borderRadius,
	width,
	children = "⌄",
	...props
}: NavigationMenuIconProps) {
	return (
		<BaseNavigationMenu.Icon
			{...props}
			className={mergeClassName(
				"inline-flex size-4 items-center justify-center transition-transform data-[popup-open]:rotate-180",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children}
		</BaseNavigationMenu.Icon>
	);
}

export type NavigationMenuOverlayProps = NavigationMenuPopupProps & {
	portalProps?: NavigationMenuPortalProps;
	positionerProps?: NavigationMenuPositionerProps;
	viewportProps?: NavigationMenuViewportProps;
};
export function NavigationMenuOverlay({
	portalProps,
	positionerProps,
	viewportProps,
	children,
	...props
}: NavigationMenuOverlayProps) {
	return (
		<NavigationMenuPortal {...portalProps}>
			<NavigationMenuPositioner {...positionerProps}>
				<NavigationMenuPopup {...props}>
					<NavigationMenuViewport {...viewportProps}>
						{children}
					</NavigationMenuViewport>
				</NavigationMenuPopup>
			</NavigationMenuPositioner>
		</NavigationMenuPortal>
	);
}

export const NavigationMenu = NavigationMenuRoot;
