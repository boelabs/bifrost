"use client";

import { type ControlProps, mergeClassName, mergeStyle } from "./appearance";
import { Input as BaseInput } from "@base-ui/react/input";
import { inputControlVariants } from "./primitives/input";
import { appearanceStyle } from "./appearance";
import { Field, useFieldScope } from "./field";
import { cn } from "#/shared/lib/classes";
import type { ReactNode } from "react";

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
		<span
			className={inputControlVariants({
				className:
					variant === "ghost"
						? "border-transparent bg-transparent shadow-none"
						: undefined,
			})}
			data-slot="input-control"
			style={appearanceStyle({
				borderRadius,
				width: ownsLayout || typeof style === "function" ? undefined : width,
			})}
		>
			<BaseInput
				{...props}
				className={mergeClassName(
					cn(
						"h-8.5 w-full min-w-0 rounded-[inherit] bg-transparent px-[calc(--spacing(3)-1px)] leading-8.5 outline-none placeholder:text-muted-foreground/72 sm:h-7.5 sm:leading-7.5",
						{
							xs: "h-6.5 sm:h-5.5",
							sm: "h-7.5 px-[calc(--spacing(2.5)-1px)] sm:h-6.5",
							md: "",
							lg: "h-9.5 sm:h-8.5",
						}[size ?? "md"],
					),
					className,
				)}
				style={mergeStyle(
					{
						borderRadius,
						width: undefined,
					},
					style,
				)}
			/>
		</span>
	);
	const content = (
		<>
			{label ? <Field.Label>{label}</Field.Label> : null}
			{control}
			{description ? (
				<Field.Description>{description}</Field.Description>
			) : null}
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

export { Input as InputPrimitive } from "@base-ui/react/input";
