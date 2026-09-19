"use client";

import { Input as BaseInput } from "@base-ui/react/input";
import { Field, useFieldScope } from "./field";
import type { ReactNode } from "react";

import {
	type ControlProps,
	mergeClassName,
	controlStyles,
	mergeStyle,
} from "./appearance";

export interface InputProps
	extends Omit<BaseInput.Props, "size" | "width">,
		ControlProps {
	label?: ReactNode;
	description?: ReactNode;
	errorMessage?: ReactNode;
}

export function Input({
	label,
	description,
	errorMessage,
	size,
	variant,
	borderRadius,
	width,
	className,
	style,
	...props
}: InputProps) {
	const hasFieldScope = useFieldScope();
	const hasSupportingContent = Boolean(label || description || errorMessage);
	const ownsLayout = !hasFieldScope && hasSupportingContent;
	const control = (
		<BaseInput
			{...props}
			className={mergeClassName(
				controlStyles({ size, variant, className: "w-full" }),
				className,
			)}
			style={mergeStyle(
				{
					borderRadius,
					width: ownsLayout ? undefined : width,
				},
				style,
			)}
		/>
	);
	const content = (
		<>
			{label && <Field.Label>{label}</Field.Label>}
			{control}
			{description && <Field.Description>{description}</Field.Description>}
			{hasSupportingContent && <Field.Error>{errorMessage}</Field.Error>}
		</>
	);
	if (hasFieldScope) {
		return content;
	}
	return (
		<Field.Root
			className={ownsLayout ? undefined : "contents"}
			disabled={props.disabled}
			name={props.name}
			width={ownsLayout ? width : undefined}
		>
			{content}
		</Field.Root>
	);
}

export { BaseInput as InputPrimitive };
