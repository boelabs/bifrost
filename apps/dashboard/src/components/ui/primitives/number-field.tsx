"use client";

import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { controlRadiusVariants } from "#/components/ui/primitives/control-radius";
import { cva, type VariantProps } from "class-variance-authority";
import { Label } from "#/components/ui/primitives/label";
import { createContext, useId, useContext } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { cn } from "#/shared/lib/classes";
import type * as React from "react";

export const numberFieldGroupVariants = cva(
	"relative flex w-full justify-between border border-input bg-background not-dark:bg-clip-padding text-base text-foreground shadow-xs/5 ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 not-data-disabled:not-focus-within:not-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] focus-within:border-ring focus-within:ring-[3px] has-aria-invalid:border-destructive/36 has-autofill:bg-foreground/4 focus-within:has-aria-invalid:border-destructive/64 focus-within:has-aria-invalid:ring-destructive/16 data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-sm dark:bg-input/32 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24 dark:not-data-disabled:not-focus-within:not-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [[data-disabled],:focus-within,[aria-invalid]]:shadow-none",
	{
		defaultVariants: {
			radius: "default",
		},
		variants: {
			radius: controlRadiusVariants,
		},
	},
);

export const NumberFieldContext: React.Context<{
	fieldId: string;
} | null> = createContext<{
	fieldId: string;
} | null>(null);

export function NumberField({
	id,
	className,
	size = "default",
	...props
}: NumberFieldPrimitive.Root.Props & {
	size?: "sm" | "default" | "lg";
}): React.ReactElement {
	const generatedId = useId();
	const fieldId = id ?? generatedId;

	return (
		<NumberFieldContext.Provider value={{ fieldId }}>
			<NumberFieldPrimitive.Root
				className={cn("flex w-full flex-col items-start gap-2", className)}
				data-size={size}
				data-slot="number-field"
				id={fieldId}
				{...props}
			/>
		</NumberFieldContext.Provider>
	);
}

export function NumberFieldGroup({
	className,
	radius,
	...props
}: NumberFieldPrimitive.Group.Props &
	VariantProps<typeof numberFieldGroupVariants>): React.ReactElement {
	return (
		<NumberFieldPrimitive.Group
			className={cn(numberFieldGroupVariants({ radius }), className)}
			data-slot="number-field-group"
			{...props}
		/>
	);
}

export function NumberFieldDecrement({
	className,
	...props
}: NumberFieldPrimitive.Decrement.Props): React.ReactElement {
	return (
		<NumberFieldPrimitive.Decrement
			aria-label="Decrease"
			className={cn(
				"relative flex shrink-0 cursor-pointer items-center justify-center rounded-s-[inherit] in-data-[size=sm]:px-[calc(--spacing(2.5)-1px)] px-[calc(--spacing(3)-1px)] transition-colors pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:bg-accent",
				className,
			)}
			data-slot="number-field-decrement"
			{...props}
		>
			<MinusIcon />
		</NumberFieldPrimitive.Decrement>
	);
}

export function NumberFieldIncrement({
	className,
	...props
}: NumberFieldPrimitive.Increment.Props): React.ReactElement {
	return (
		<NumberFieldPrimitive.Increment
			aria-label="Increase"
			className={cn(
				"relative flex shrink-0 cursor-pointer items-center justify-center rounded-e-[inherit] in-data-[size=sm]:px-[calc(--spacing(2.5)-1px)] px-[calc(--spacing(3)-1px)] transition-colors pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:bg-accent",
				className,
			)}
			data-slot="number-field-increment"
			{...props}
		>
			<PlusIcon />
		</NumberFieldPrimitive.Increment>
	);
}

export function NumberFieldInput({
	className,
	...props
}: NumberFieldPrimitive.Input.Props): React.ReactElement {
	return (
		<NumberFieldPrimitive.Input
			className={cn(
				"h-8.5 in-data-[size=lg]:h-9.5 in-data-[size=sm]:h-7.5 w-full min-w-0 grow bg-transparent in-data-[size=sm]:px-[calc(--spacing(2.5)-1px)] px-[calc(--spacing(3)-1px)] text-center tabular-nums in-data-[size=lg]:leading-9.5 in-data-[size=sm]:leading-7.5 leading-8.5 outline-none [transition:background-color_5000000s_ease-in-out_0s] sm:h-7.5 sm:in-data-[size=lg]:h-8.5 sm:in-data-[size=sm]:h-6.5 sm:in-data-[size=lg]:leading-8.5 sm:in-data-[size=sm]:leading-8.5 sm:leading-7.5",
				className,
			)}
			data-slot="number-field-input"
			{...props}
		/>
	);
}

export function NumberFieldScrubArea({
	className,
	label,
	...props
}: NumberFieldPrimitive.ScrubArea.Props & {
	label: string;
}): React.ReactElement {
	const context = useContext(NumberFieldContext);

	if (!context) {
		throw new Error(
			"NumberFieldScrubArea must be used within a NumberField component for accessibility.",
		);
	}

	return (
		<NumberFieldPrimitive.ScrubArea
			className={cn("flex cursor-ew-resize", className)}
			data-slot="number-field-scrub-area"
			{...props}
		>
			<Label className="cursor-ew-resize" htmlFor={context.fieldId}>
				{label}
			</Label>
			<NumberFieldPrimitive.ScrubAreaCursor className="drop-shadow-[0_1px_1px_#0008] filter">
				<CursorGrowIcon />
			</NumberFieldPrimitive.ScrubAreaCursor>
		</NumberFieldPrimitive.ScrubArea>
	);
}

export function CursorGrowIcon(
	props: React.ComponentProps<"svg">,
): React.ReactElement {
	return (
		<svg
			aria-hidden="true"
			fill="black"
			height="14"
			stroke="white"
			viewBox="0 0 24 14"
			width="26"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<path d="M19.5 5.5L6.49737 5.51844V2L1 6.9999L6.5 12L6.49737 8.5L19.5 8.5V12L25 6.9999L19.5 2V5.5Z" />
		</svg>
	);
}

export { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
