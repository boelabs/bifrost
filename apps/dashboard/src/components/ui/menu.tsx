"use client";

import { overlayButtonStyles, overlayArrowStyles } from "./dialog";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ComponentProps } from "react";

import {
	type AppearanceProps,
	mergeClassName,
	popupStyles,
	mergeStyle,
	itemStyles,
} from "./appearance";

export const MenuRoot = BaseMenu.Root;
export const Menu = BaseMenu.Root;
export const MenuSubmenuRoot = BaseMenu.SubmenuRoot;
export const MenuHandle = BaseMenu.Handle;
export const createMenuHandle = BaseMenu.createHandle;

export type MenuTriggerProps<Payload = unknown> =
	BaseMenu.Trigger.Props<Payload> & AppearanceProps;
export function MenuTrigger<Payload = unknown>({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuTriggerProps<Payload>) {
	return (
		<BaseMenu.Trigger
			{...props}
			className={mergeClassName(overlayButtonStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuPortalProps = ComponentProps<typeof BaseMenu.Portal> &
	AppearanceProps;
export function MenuPortal({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuPortalProps) {
	return (
		<BaseMenu.Portal
			{...props}
			className={mergeClassName("relative z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuPositionerProps = ComponentProps<typeof BaseMenu.Positioner> &
	AppearanceProps;
export function MenuPositioner({
	className,
	style,
	borderRadius,
	width,
	sideOffset = 6,
	// Against the viewport, not the document — see `select.tsx` for what `absolute` costs.
	positionMethod = "fixed",
	...props
}: MenuPositionerProps) {
	return (
		<BaseMenu.Positioner
			positionMethod={positionMethod}
			{...props}
			sideOffset={sideOffset}
			className={mergeClassName("z-50 outline-none", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuPopupProps = ComponentProps<typeof BaseMenu.Popup> &
	AppearanceProps;
export function MenuPopup({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuPopupProps) {
	return (
		<BaseMenu.Popup
			{...props}
			className={mergeClassName(`${popupStyles} min-w-48`, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuArrowProps = ComponentProps<typeof BaseMenu.Arrow> &
	AppearanceProps;
export function MenuArrow({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuArrowProps) {
	return (
		<BaseMenu.Arrow
			{...props}
			className={mergeClassName(overlayArrowStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuBackdropProps = ComponentProps<typeof BaseMenu.Backdrop> &
	AppearanceProps;
export function MenuBackdrop({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuBackdropProps) {
	return (
		<BaseMenu.Backdrop
			{...props}
			className={mergeClassName("fixed inset-0 z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuItemProps = ComponentProps<typeof BaseMenu.Item> &
	AppearanceProps;
export function MenuItem({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuItemProps) {
	return (
		<BaseMenu.Item
			{...props}
			className={mergeClassName(itemStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuLinkItemProps = ComponentProps<typeof BaseMenu.LinkItem> &
	AppearanceProps;
export function MenuLinkItem({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuLinkItemProps) {
	return (
		<BaseMenu.LinkItem
			{...props}
			className={mergeClassName(itemStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuCheckboxItemProps = ComponentProps<
	typeof BaseMenu.CheckboxItem
> &
	AppearanceProps;
export function MenuCheckboxItem({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuCheckboxItemProps) {
	return (
		<BaseMenu.CheckboxItem
			{...props}
			className={mergeClassName(itemStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuCheckboxItemIndicatorProps = ComponentProps<
	typeof BaseMenu.CheckboxItemIndicator
> &
	AppearanceProps;
export function MenuCheckboxItemIndicator({
	className,
	style,
	borderRadius,
	width,
	children = "✓",
	...props
}: MenuCheckboxItemIndicatorProps) {
	return (
		<BaseMenu.CheckboxItemIndicator
			{...props}
			className={mergeClassName(
				"ml-auto flex size-4 shrink-0 items-center justify-center text-primary data-[unchecked]:invisible",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children}
		</BaseMenu.CheckboxItemIndicator>
	);
}

export type MenuRadioGroupProps = ComponentProps<typeof BaseMenu.RadioGroup> &
	AppearanceProps;
export function MenuRadioGroup({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuRadioGroupProps) {
	return (
		<BaseMenu.RadioGroup
			{...props}
			className={mergeClassName("flex flex-col gap-0.5", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuRadioItemProps = ComponentProps<typeof BaseMenu.RadioItem> &
	AppearanceProps;
export function MenuRadioItem({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuRadioItemProps) {
	return (
		<BaseMenu.RadioItem
			{...props}
			className={mergeClassName(itemStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuRadioItemIndicatorProps = ComponentProps<
	typeof BaseMenu.RadioItemIndicator
> &
	AppearanceProps;
export function MenuRadioItemIndicator({
	className,
	style,
	borderRadius,
	width,
	children = "●",
	...props
}: MenuRadioItemIndicatorProps) {
	return (
		<BaseMenu.RadioItemIndicator
			{...props}
			className={mergeClassName(
				"ml-auto flex size-4 shrink-0 items-center justify-center text-xs text-primary data-[unchecked]:invisible",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children}
		</BaseMenu.RadioItemIndicator>
	);
}

export type MenuGroupProps = ComponentProps<typeof BaseMenu.Group> &
	AppearanceProps;
export function MenuGroup({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuGroupProps) {
	return (
		<BaseMenu.Group
			{...props}
			className={mergeClassName("flex flex-col gap-0.5", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuGroupLabelProps = ComponentProps<typeof BaseMenu.GroupLabel> &
	AppearanceProps;
export function MenuGroupLabel({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuGroupLabelProps) {
	return (
		<BaseMenu.GroupLabel
			{...props}
			className={mergeClassName(
				"px-3 py-2 text-xs font-semibold text-fg-muted",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuSeparatorProps = ComponentProps<typeof BaseMenu.Separator> &
	AppearanceProps;
export function MenuSeparator({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuSeparatorProps) {
	return (
		<BaseMenu.Separator
			{...props}
			className={mergeClassName("my-1 h-px bg-border", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuSubmenuTriggerProps = ComponentProps<
	typeof BaseMenu.SubmenuTrigger
> &
	AppearanceProps;
export function MenuSubmenuTrigger({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuSubmenuTriggerProps) {
	return (
		<BaseMenu.SubmenuTrigger
			{...props}
			className={mergeClassName(
				`${itemStyles} justify-between data-[popup-open]:bg-secondary`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuViewportProps = ComponentProps<typeof BaseMenu.Viewport> &
	AppearanceProps;
export function MenuViewport({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenuViewportProps) {
	return (
		<BaseMenu.Viewport
			{...props}
			className={mergeClassName("relative min-w-0", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type MenuContentProps = MenuPopupProps & {
	portalProps?: MenuPortalProps;
	positionerProps?: MenuPositionerProps;
};
export function MenuContent({
	portalProps,
	positionerProps,
	...props
}: MenuContentProps) {
	return (
		<MenuPortal {...portalProps}>
			<MenuPositioner {...positionerProps}>
				<MenuPopup {...props} />
			</MenuPositioner>
		</MenuPortal>
	);
}

export const MenuSection = MenuGroup;
export const MenuHeader = MenuGroupLabel;
export const MenuSeperator = MenuSeparator;
