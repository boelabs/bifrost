"use client";

import { mergeClassName, mergeStyle, type AppearanceProps } from "./appearance";
import { Form as BaseForm } from "@base-ui/react/form";

export interface FormProps extends BaseForm.Props, AppearanceProps {}
export function Form({
	className,
	style,
	borderRadius,
	width,
	...props
}: FormProps) {
	return (
		<BaseForm
			{...props}
			className={mergeClassName("min-w-0", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
