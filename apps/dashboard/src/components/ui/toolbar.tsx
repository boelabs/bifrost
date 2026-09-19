"use client";

import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	controlStyles,
	mergeStyle,
} from "./appearance";

export type ToolbarRootProps = BaseToolbar.Root.Props & AppearanceProps;
export type ToolbarGroupProps = BaseToolbar.Group.Props & AppearanceProps;
export type ToolbarButtonProps = BaseToolbar.Button.Props & ControlProps;
export type ToolbarLinkProps = BaseToolbar.Link.Props & ControlProps;
export type ToolbarInputProps = Omit<BaseToolbar.Input.Props, "size"> &
	ControlProps & { htmlSize?: number };
export type ToolbarSeparatorProps = BaseToolbar.Separator.Props &
	AppearanceProps;

export function ToolbarRoot({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToolbarRootProps) {
	return (
		<BaseToolbar.Root
			{...props}
			className={mergeClassName(
				"flex w-fit max-w-full items-center gap-1 rounded-(--ui-radius-surface) border border-border bg-surface p-1 data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ToolbarGroup({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToolbarGroupProps) {
	return (
		<BaseToolbar.Group
			{...props}
			className={mergeClassName(
				"flex items-center gap-1 rounded-(--ui-radius-control) data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ToolbarButton({
	className,
	style,
	borderRadius,
	width,
	size = "sm",
	variant = "ghost",
	...props
}: ToolbarButtonProps) {
	return (
		<BaseToolbar.Button
			{...props}
			className={mergeClassName(
				controlStyles({
					size,
					variant,
					className:
						"cursor-pointer justify-center font-medium aria-pressed:bg-primary/10 aria-pressed:text-primary",
				}),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ToolbarLink({
	className,
	style,
	borderRadius,
	width,
	size = "sm",
	variant = "ghost",
	...props
}: ToolbarLinkProps) {
	return (
		<BaseToolbar.Link
			{...props}
			className={mergeClassName(
				controlStyles({
					size,
					variant,
					className:
						"cursor-pointer justify-center font-medium text-primary underline-offset-4 hover:underline",
				}),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ToolbarInput({
	className,
	style,
	borderRadius,
	width,
	size = "sm",
	variant = "outlined",
	htmlSize,
	...props
}: ToolbarInputProps) {
	return (
		<BaseToolbar.Input
			{...props}
			className={mergeClassName(controlStyles({ size, variant }), className)}
			size={htmlSize}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ToolbarSeparator({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToolbarSeparatorProps) {
	return (
		<BaseToolbar.Separator
			{...props}
			className={mergeClassName(
				"shrink-0 bg-border data-[orientation=vertical]:mx-1 data-[orientation=horizontal]:my-1 data-[orientation=vertical]:my-1 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export const Toolbar = {
	Root: ToolbarRoot,
	Group: ToolbarGroup,
	Button: ToolbarButton,
	Link: ToolbarLink,
	Input: ToolbarInput,
	Separator: ToolbarSeparator,
};
