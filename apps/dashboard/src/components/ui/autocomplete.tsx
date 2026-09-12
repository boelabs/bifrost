"use client";

import { Autocomplete as BaseAutocomplete } from "@base-ui/react/autocomplete";
import { IconSelector, IconX } from "@tabler/icons-react";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	controlStyles,
	labelStyles,
	popupStyles,
	itemStyles,
	mergeStyle,
	focusRing,
} from "./appearance";

function Input({
	className,
	style,
	borderRadius,
	width,
	size,
	variant,
	...props
}: Omit<BaseAutocomplete.Input.Props, "size" | "width"> & ControlProps) {
	return (
		<BaseAutocomplete.Input
			{...props}
			className={mergeClassName(
				controlStyles({ size, variant, className: "w-full" }),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Trigger({
	className,
	style,
	borderRadius,
	width,
	children,
	size,
	variant,
	...props
}: BaseAutocomplete.Trigger.Props & ControlProps) {
	return (
		<BaseAutocomplete.Trigger
			{...props}
			className={mergeClassName(controlStyles({ size, variant }), className)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children ?? <IconSelector className="size-4" />}
		</BaseAutocomplete.Trigger>
	);
}
function Popup({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseAutocomplete.Popup.Props & AppearanceProps) {
	return (
		<BaseAutocomplete.Popup
			{...props}
			className={mergeClassName(
				`${popupStyles} min-w-[var(--anchor-width)]`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function List({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseAutocomplete.List.Props & AppearanceProps) {
	return (
		<BaseAutocomplete.List
			{...props}
			className={mergeClassName(
				"max-h-64 overflow-auto outline-none empty:p-0",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Item({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseAutocomplete.Item.Props & AppearanceProps) {
	return (
		<BaseAutocomplete.Item
			{...props}
			className={mergeClassName(itemStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Empty({ className, ...props }: BaseAutocomplete.Empty.Props) {
	return (
		<BaseAutocomplete.Empty
			{...props}
			className={mergeClassName(
				"px-3 py-4 text-sm text-fg-muted empty:hidden",
				className,
			)}
		/>
	);
}
function GroupLabel({
	className,
	...props
}: BaseAutocomplete.GroupLabel.Props) {
	return (
		<BaseAutocomplete.GroupLabel
			{...props}
			className={mergeClassName(`${labelStyles} px-3 py-2`, className)}
		/>
	);
}
function Clear({
	className,
	style,
	borderRadius,
	width,
	children,
	...props
}: BaseAutocomplete.Clear.Props & AppearanceProps) {
	return (
		<BaseAutocomplete.Clear
			{...props}
			className={mergeClassName(
				`${focusRing} inline-flex size-7 items-center justify-center rounded-[var(--ui-radius-item)] text-fg-muted hover:bg-secondary`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children ?? <IconX className="size-4" />}
		</BaseAutocomplete.Clear>
	);
}
export const Autocomplete = {
	...BaseAutocomplete,
	Input,
	Trigger,
	Popup,
	List,
	Item,
	Empty,
	GroupLabel,
	Clear,
};
