"use client";

import { IconCheck, IconSelector, IconX } from "@tabler/icons-react";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";

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
}: Omit<BaseCombobox.Input.Props, "size" | "width"> & ControlProps) {
	return (
		<BaseCombobox.Input
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
}: BaseCombobox.Trigger.Props & ControlProps) {
	return (
		<BaseCombobox.Trigger
			{...props}
			className={mergeClassName(controlStyles({ size, variant }), className)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children ?? <IconSelector className="size-4" />}
		</BaseCombobox.Trigger>
	);
}
/**
 * Positioned `fixed`, not `absolute`, for the reason spelled out in `select.tsx`: an absolutely
 * positioned popup is part of the document's flow for the frame before it is placed, which can make
 * the page taller and send the browser scrolling after the item it just focused.
 */
function Positioner({
	positionMethod = "fixed",
	...props
}: BaseCombobox.Positioner.Props) {
	return <BaseCombobox.Positioner positionMethod={positionMethod} {...props} />;
}
function Popup({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseCombobox.Popup.Props & AppearanceProps) {
	return (
		<BaseCombobox.Popup
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
}: BaseCombobox.List.Props & AppearanceProps) {
	return (
		<BaseCombobox.List
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
}: BaseCombobox.Item.Props & AppearanceProps) {
	return (
		<BaseCombobox.Item
			{...props}
			className={mergeClassName(itemStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function ItemIndicator({
	className,
	children,
	...props
}: BaseCombobox.ItemIndicator.Props) {
	return (
		<BaseCombobox.ItemIndicator
			{...props}
			className={mergeClassName("ml-auto", className)}
		>
			{children ?? <IconCheck className="size-4" />}
		</BaseCombobox.ItemIndicator>
	);
}
function Empty({ className, ...props }: BaseCombobox.Empty.Props) {
	return (
		<BaseCombobox.Empty
			{...props}
			className={mergeClassName(
				"px-3 py-4 text-sm text-fg-muted empty:hidden",
				className,
			)}
		/>
	);
}
function GroupLabel({ className, ...props }: BaseCombobox.GroupLabel.Props) {
	return (
		<BaseCombobox.GroupLabel
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
}: BaseCombobox.Clear.Props & AppearanceProps) {
	return (
		<BaseCombobox.Clear
			{...props}
			className={mergeClassName(
				`${focusRing} inline-flex size-7 items-center justify-center rounded-[var(--ui-radius-item)] text-fg-muted hover:bg-secondary`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children ?? <IconX className="size-4" />}
		</BaseCombobox.Clear>
	);
}
function Chips({
	className,
	style,
	borderRadius,
	width,
	size,
	variant,
	...props
}: BaseCombobox.Chips.Props & ControlProps) {
	return (
		<BaseCombobox.Chips
			{...props}
			className={mergeClassName(
				controlStyles({ size, variant, className: "flex-wrap" }),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Chip({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseCombobox.Chip.Props & AppearanceProps) {
	return (
		<BaseCombobox.Chip
			{...props}
			className={mergeClassName(
				"inline-flex items-center gap-1 rounded-[var(--ui-radius-item)] bg-secondary px-2 py-1 text-sm text-secondary-fg",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function ChipRemove({
	className,
	style,
	borderRadius,
	width,
	children,
	...props
}: BaseCombobox.ChipRemove.Props & AppearanceProps) {
	return (
		<BaseCombobox.ChipRemove
			{...props}
			className={mergeClassName(
				`${focusRing} rounded-[var(--ui-radius-item)] hover:bg-surface`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children ?? <IconX className="size-3.5" />}
		</BaseCombobox.ChipRemove>
	);
}
/**
 * The input and its inline controls as one field.
 *
 * A bare combobox input looks exactly like a text input, which is the whole problem: nothing on it
 * says a list exists. The group carries the border and focus ring, and the chevron and clear button
 * sit inside it — so the control announces what it is, and the only thing a caller has to decide is
 * whether clearing makes sense for that field.
 */
function InputGroup({
	className,
	style,
	borderRadius,
	width,
	size,
	variant,
	...props
}: Omit<BaseCombobox.InputGroup.Props, "size" | "width"> & ControlProps) {
	return (
		<BaseCombobox.InputGroup
			{...props}
			className={mergeClassName(
				controlStyles({
					size,
					variant,
					// The inline controls keep the same breathing room from the edge as the text does from
					// the other side; at pr-1 the chevron sat on the border.
					className:
						"w-full cursor-text gap-1 pr-2 has-[input:focus-visible]:border-focus has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-focus/25",
				}),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

/** The input inside a group or a chip row: the frame around it already draws the border. */
function BareInput({
	className,
	...props
}: Omit<BaseCombobox.Input.Props, "size" | "width">) {
	return (
		<BaseCombobox.Input
			{...props}
			className={mergeClassName(
				"min-w-16 flex-1 border-0 bg-transparent p-0 text-inherit outline-none placeholder:text-fg-muted",
				className,
			)}
		/>
	);
}

const inlineButton =
	"inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--ui-radius-item)] text-fg-muted hover:bg-secondary hover:text-fg";

function InlineTrigger({
	className,
	children,
	...props
}: BaseCombobox.Trigger.Props) {
	return (
		<BaseCombobox.Trigger
			{...props}
			className={mergeClassName(`${inlineButton} ${focusRing}`, className)}
		>
			{children ?? <IconSelector className="size-4" />}
		</BaseCombobox.Trigger>
	);
}

function InlineClear({
	className,
	children,
	...props
}: BaseCombobox.Clear.Props) {
	return (
		<BaseCombobox.Clear
			{...props}
			className={mergeClassName(`${inlineButton} ${focusRing}`, className)}
		>
			{children ?? <IconX className="size-4" />}
		</BaseCombobox.Clear>
	);
}

export interface InputFieldProps
	extends Omit<BaseCombobox.Input.Props, "size" | "width">,
		ControlProps {
	/** The chevron that opens the list. On by default — it is what makes this look like a combobox. */
	showTrigger?: boolean;
	/** Offer to empty the field. Only for fields where "nothing selected" is a valid state. */
	showClear?: boolean;
	groupClassName?: string;
}

function InputField({
	showTrigger = true,
	showClear = false,
	size,
	variant,
	borderRadius,
	width,
	groupClassName,
	...props
}: InputFieldProps) {
	return (
		<InputGroup
			size={size}
			variant={variant}
			borderRadius={borderRadius}
			width={width}
			className={groupClassName}
		>
			<BareInput {...props} />
			{showClear ? <InlineClear /> : null}
			{showTrigger ? <InlineTrigger /> : null}
		</InputGroup>
	);
}

export const Combobox = {
	...BaseCombobox,
	Positioner,
	Input,
	InputGroup,
	InputField,
	ChipsInput: BareInput,
	InlineTrigger,
	InlineClear,
	Trigger,
	Popup,
	List,
	Item,
	ItemIndicator,
	Empty,
	GroupLabel,
	Clear,
	Chips,
	Chip,
	ChipRemove,
};
export const ComboBox = Combobox;
export const ComboBoxItem = Item;
export type ComboBoxProps<
	Value,
	Multiple extends boolean | undefined = false,
> = BaseCombobox.Root.Props<Value, Multiple>;
export type ComboBoxItemProps = BaseCombobox.Item.Props & AppearanceProps;
