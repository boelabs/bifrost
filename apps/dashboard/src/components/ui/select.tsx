"use client";

import { Children, isValidElement, type ReactNode } from "react";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Combobox } from "./combobox";
import { Field } from "./field";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	controlStyles,
	popupStyles,
	itemStyles,
	mergeStyle,
} from "./appearance";

function Trigger({
	className,
	style,
	borderRadius,
	width,
	size,
	variant,
	...props
}: BaseSelect.Trigger.Props & ControlProps) {
	return (
		<BaseSelect.Trigger
			{...props}
			className={mergeClassName(
				controlStyles({
					size,
					variant,
					className: "w-full justify-between text-left",
				}),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Popup({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseSelect.Popup.Props & AppearanceProps) {
	return (
		<BaseSelect.Popup
			{...props}
			className={mergeClassName(
				`${popupStyles} min-w-[var(--anchor-width)]`,
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
}: BaseSelect.Item.Props & AppearanceProps) {
	return (
		<BaseSelect.Item
			{...props}
			className={mergeClassName(itemStyles, className)}
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
}: BaseSelect.List.Props & AppearanceProps) {
	return (
		<BaseSelect.List
			{...props}
			className={mergeClassName(
				"max-h-64 overflow-auto outline-none",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
export const SelectPrimitive = { ...BaseSelect, Trigger, Popup, Item, List };
export interface SelectItemProps
	extends BaseSelect.Item.Props,
		AppearanceProps {}
export function SelectItem({ children, ...props }: SelectItemProps) {
	return (
		<Item {...props}>
			<BaseSelect.ItemText>{children}</BaseSelect.ItemText>
			<BaseSelect.ItemIndicator className="ml-auto">
				<IconCheck className="size-4" />
			</BaseSelect.ItemIndicator>
		</Item>
	);
}
export interface SelectProps<Value = string>
	extends Omit<BaseSelect.Root.Props<Value>, "children">,
		ControlProps {
	children?: ReactNode;
	label?: ReactNode;
	description?: ReactNode;
	errorMessage?: ReactNode;
	placeholder?: ReactNode;
	className?: BaseSelect.Trigger.Props["className"];
	style?: BaseSelect.Trigger.Props["style"];
	popoverClassName?: BaseSelect.Popup.Props["className"];
	"aria-label"?: string;
}
export function Select<Value = string>({
	children,
	label,
	description,
	errorMessage,
	placeholder,
	className,
	style,
	popoverClassName,
	size,
	variant,
	borderRadius,
	width,
	"aria-label": ariaLabel,
	...props
}: SelectProps<Value>) {
	const items = Children.toArray(children).flatMap((child) =>
		isValidElement<SelectItemProps>(child) && child.type === SelectItem
			? [{ value: child.props.value, label: child.props.children }]
			: [],
	);
	return (
		<Field.Root disabled={props.disabled} name={props.name} width={width}>
			{label && <Field.Label>{label}</Field.Label>}
			{/**
			 * Not modal by default. A modal popup locks page scroll, and locking it toggles the
			 * document's scrollbar: on a platform with classic scrollbars the whole layout shifts by
			 * its width as the list opens and closes — and a select nested in a dialog does it twice,
			 * which reads as the page flashing. Nothing here needs the lock: this app scrolls inside
			 * its own panes, and the select still closes on an outside press.
			 */}
			<BaseSelect.Root modal={false} {...props} items={props.items ?? items}>
				<Trigger
					aria-label={ariaLabel}
					className={className}
					style={style}
					size={size}
					variant={variant}
					borderRadius={borderRadius}
				>
					<BaseSelect.Value
						placeholder={placeholder}
						className="truncate data-[placeholder]:text-fg-muted"
					/>
					<BaseSelect.Icon>
						<IconChevronDown className="size-4 shrink-0 text-fg-muted" />
					</BaseSelect.Icon>
				</Trigger>
				<BaseSelect.Portal>
					{/**
					 * Positioned `fixed`, not `absolute`.
					 *
					 * An absolutely positioned popup is part of the document's flow: for the frame
					 * between being portalled to the end of `body` and being placed, it can make the
					 * page taller, and the browser scrolls the item it just focused into view. The page
					 * lurches and snaps back a frame later, when the popup lands where it belongs.
					 * Fixed, it never contributes to the page's height, so there is nothing to scroll.
					 */}
					<BaseSelect.Positioner
						positionMethod="fixed"
						sideOffset={6}
						alignItemWithTrigger={false}
						className="z-50"
					>
						<Popup className={popoverClassName}>
							<List>{children}</List>
						</Popup>
					</BaseSelect.Positioner>
				</BaseSelect.Portal>
			</BaseSelect.Root>
			{description && <Field.Description>{description}</Field.Description>}
			<Field.Error>{errorMessage}</Field.Error>
		</Field.Root>
	);
}

export interface SearchableSelectOption {
	value: string;
	label: string;
	disabled?: boolean;
}
export interface SearchableSelectProps
	extends Omit<ComboboxRootProps, "items">,
		ControlProps {
	items: readonly SearchableSelectOption[];
	label?: ReactNode;
	description?: ReactNode;
	errorMessage?: ReactNode;
	searchPlaceholder?: string;
	className?: string;
	"aria-label"?: string;
}
type ComboboxRootProps =
	import("@base-ui/react/combobox").Combobox.Root.Props<string>;
export function SearchableSelect({
	items,
	label,
	description,
	errorMessage,
	searchPlaceholder = "Search...",
	className,
	size,
	variant,
	borderRadius,
	width,
	"aria-label": ariaLabel,
	...props
}: SearchableSelectProps) {
	const labels = new Map(items.map((item) => [item.value, item.label]));
	return (
		<Field.Root disabled={props.disabled} name={props.name} width={width}>
			{label && <Field.Label>{label}</Field.Label>}
			<Combobox.Root
				{...props}
				items={items.map((item) => item.value)}
				itemToStringLabel={(value) => labels.get(value) ?? value}
			>
				<Combobox.Input
					aria-label={ariaLabel}
					placeholder={searchPlaceholder}
					className={className}
					size={size}
					variant={variant}
					borderRadius={borderRadius}
				/>
				<Combobox.Portal>
					<Combobox.Positioner sideOffset={6} className="z-50">
						<Combobox.Popup>
							<Combobox.Empty>No results found.</Combobox.Empty>
							<Combobox.List>
								{(value: string) => (
									<Combobox.Item
										key={value}
										value={value}
										disabled={
											items.find((item) => item.value === value)?.disabled
										}
									>
										{labels.get(value)}
										<Combobox.ItemIndicator />
									</Combobox.Item>
								)}
							</Combobox.List>
						</Combobox.Popup>
					</Combobox.Positioner>
				</Combobox.Portal>
			</Combobox.Root>
			{description && <Field.Description>{description}</Field.Description>}
			<Field.Error>{errorMessage}</Field.Error>
		</Field.Root>
	);
}
