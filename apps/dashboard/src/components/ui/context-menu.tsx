"use client";

import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import type { ComponentProps } from "react";

import {
	type AppearanceProps,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance";

import {
	type MenuPortalProps,
	type MenuPopupProps,
	MenuPortal,
	MenuPopup,
} from "./menu";

export {
	MenuArrow as ContextMenuArrow,
	MenuBackdrop as ContextMenuBackdrop,
	MenuCheckboxItem as ContextMenuCheckboxItem,
	MenuCheckboxItemIndicator as ContextMenuCheckboxItemIndicator,
	MenuGroup as ContextMenuGroup,
	MenuGroupLabel as ContextMenuGroupLabel,
	MenuItem as ContextMenuItem,
	MenuLinkItem as ContextMenuLinkItem,
	MenuPopup as ContextMenuPopup,
	MenuPortal as ContextMenuPortal,
	MenuRadioGroup as ContextMenuRadioGroup,
	MenuRadioItem as ContextMenuRadioItem,
	MenuRadioItemIndicator as ContextMenuRadioItemIndicator,
	MenuSeparator as ContextMenuSeparator,
	MenuSubmenuRoot as ContextMenuSubmenuRoot,
	MenuSubmenuTrigger as ContextMenuSubmenuTrigger,
} from "./menu";
export type {
	MenuArrowProps as ContextMenuArrowProps,
	MenuBackdropProps as ContextMenuBackdropProps,
	MenuCheckboxItemProps as ContextMenuCheckboxItemProps,
	MenuCheckboxItemIndicatorProps as ContextMenuCheckboxItemIndicatorProps,
	MenuGroupProps as ContextMenuGroupProps,
	MenuGroupLabelProps as ContextMenuGroupLabelProps,
	MenuItemProps as ContextMenuItemProps,
	MenuLinkItemProps as ContextMenuLinkItemProps,
	MenuPopupProps as ContextMenuPopupProps,
	MenuPortalProps as ContextMenuPortalProps,
	MenuRadioGroupProps as ContextMenuRadioGroupProps,
	MenuRadioItemProps as ContextMenuRadioItemProps,
	MenuRadioItemIndicatorProps as ContextMenuRadioItemIndicatorProps,
	MenuSeparatorProps as ContextMenuSeparatorProps,
	MenuSubmenuTriggerProps as ContextMenuSubmenuTriggerProps,
} from "./menu";

export const ContextMenuRoot = BaseContextMenu.Root;
export const ContextMenu = BaseContextMenu.Root;

export type ContextMenuTriggerProps = ComponentProps<
	typeof BaseContextMenu.Trigger
> &
	AppearanceProps;
export function ContextMenuTrigger({
	className,
	style,
	borderRadius,
	width,
	...props
}: ContextMenuTriggerProps) {
	return (
		<BaseContextMenu.Trigger
			{...props}
			className={mergeClassName(
				`rounded-[var(--ui-radius-control)] ${focusRing}`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type ContextMenuPositionerProps = ComponentProps<
	typeof BaseContextMenu.Positioner
> &
	AppearanceProps;
export function ContextMenuPositioner({
	className,
	style,
	borderRadius,
	width,
	// Against the viewport, not the document — see `select.tsx` for what `absolute` costs.
	positionMethod = "fixed",
	...props
}: ContextMenuPositionerProps) {
	return (
		<BaseContextMenu.Positioner
			positionMethod={positionMethod}
			{...props}
			className={mergeClassName("z-50 outline-none", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type ContextMenuContentProps = MenuPopupProps & {
	portalProps?: MenuPortalProps;
	positionerProps?: ContextMenuPositionerProps;
};
export function ContextMenuContent({
	portalProps,
	positionerProps,
	...props
}: ContextMenuContentProps) {
	return (
		<MenuPortal {...portalProps}>
			<ContextMenuPositioner {...positionerProps}>
				<MenuPopup {...props} />
			</ContextMenuPositioner>
		</MenuPortal>
	);
}
