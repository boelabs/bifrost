"use client";

import { type AppearanceProps, mergeClassName, mergeStyle } from "./appearance";
import { Menubar as BaseMenubar } from "@base-ui/react/menubar";
import type { ComponentProps } from "react";

export {
	MenuRoot as MenubarMenu,
	MenuTrigger as MenubarTrigger,
	MenuPortal as MenubarPortal,
	MenuPositioner as MenubarPositioner,
	MenuPopup as MenubarPopup,
	MenuContent as MenubarContent,
	MenuArrow as MenubarArrow,
	MenuBackdrop as MenubarBackdrop,
	MenuViewport as MenubarViewport,
	MenuItem as MenubarItem,
	MenuLinkItem as MenubarLinkItem,
	MenuCheckboxItem as MenubarCheckboxItem,
	MenuCheckboxItemIndicator as MenubarCheckboxItemIndicator,
	MenuRadioGroup as MenubarRadioGroup,
	MenuRadioItem as MenubarRadioItem,
	MenuRadioItemIndicator as MenubarRadioItemIndicator,
	MenuGroup as MenubarGroup,
	MenuGroupLabel as MenubarGroupLabel,
	MenuSeparator as MenubarSeparator,
	MenuSubmenuRoot as MenubarSubmenuRoot,
	MenuSubmenuTrigger as MenubarSubmenuTrigger,
} from "./menu";

export type MenubarProps = ComponentProps<typeof BaseMenubar> & AppearanceProps;
export function Menubar({
	className,
	style,
	borderRadius,
	width,
	...props
}: MenubarProps) {
	return (
		<BaseMenubar
			{...props}
			className={mergeClassName(
				"flex items-center gap-1 rounded-[var(--ui-radius-control)] border border-border bg-surface p-1 text-fg data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
export const MenubarRoot = Menubar;
