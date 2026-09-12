"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { createContext, useContext } from "react";

import {
	type AppearanceProps,
	descriptionStyles,
	type ControlProps,
	mergeClassName,
	controlStyles,
	errorStyles,
	labelStyles,
	mergeStyle,
} from "./appearance";

const FieldScopeContext = createContext(false);

export function useFieldScope() {
	return useContext(FieldScopeContext);
}

function Root({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseField.Root.Props & AppearanceProps) {
	return (
		<FieldScopeContext.Provider value={true}>
			<BaseField.Root
				{...props}
				className={mergeClassName("flex min-w-0 flex-col gap-1.5", className)}
				style={mergeStyle({ borderRadius, width }, style)}
			/>
		</FieldScopeContext.Provider>
	);
}
function Label({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseField.Label.Props & AppearanceProps) {
	return (
		<BaseField.Label
			{...props}
			className={mergeClassName(labelStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Description({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseField.Description.Props & AppearanceProps) {
	return (
		<BaseField.Description
			{...props}
			className={mergeClassName(descriptionStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function FieldError({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseField.Error.Props & AppearanceProps) {
	return (
		<BaseField.Error
			{...props}
			className={mergeClassName(errorStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Control({
	className,
	style,
	borderRadius,
	width,
	size,
	variant,
	...props
}: Omit<BaseField.Control.Props, "size" | "width"> & ControlProps) {
	return (
		<BaseField.Control
			{...props}
			className={mergeClassName(controlStyles({ size, variant }), className)}
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
}: BaseField.Item.Props & AppearanceProps) {
	return (
		<BaseField.Item
			{...props}
			className={mergeClassName("flex items-center gap-2", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
export const Field = {
	...BaseField,
	Root,
	Label,
	Description,
	Error: FieldError,
	Control,
	Item,
};
