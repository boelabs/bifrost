"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { mergeClassName, mergeStyle } from "./appearance";

import {
	type DialogPopupProps,
	DialogBackdrop,
	DialogViewport,
	DialogTrigger,
	DialogPortal,
	DialogPopup,
} from "./dialog";

type ModalAppearance = Pick<
	DialogPopupProps,
	"className" | "style" | "borderRadius" | "width" | "effect"
>;
const ModalAppearanceContext = createContext<ModalAppearance>({});

export type ModalProps<Payload = unknown> = Omit<
	BaseDialog.Root.Props<Payload>,
	"children"
> &
	ModalAppearance & {
		children?: ReactNode;
		isOpen?: boolean;
		isDismissable?: boolean;
		isKeyboardDismissDisabled?: boolean;
	};

export function Modal<Payload = unknown>({
	children,
	className,
	style,
	borderRadius,
	width,
	effect,
	open,
	isOpen,
	isDismissable = true,
	isKeyboardDismissDisabled = false,
	onOpenChange,
	disablePointerDismissal,
	...props
}: ModalProps<Payload>) {
	return (
		<BaseDialog.Root
			{...props}
			disablePointerDismissal={disablePointerDismissal ?? !isDismissable}
			onOpenChange={(nextOpen, details) => {
				if (isKeyboardDismissDisabled && details.reason === "escape-key") {
					details.cancel();
					return;
				}
				onOpenChange?.(nextOpen, details);
			}}
			open={open ?? isOpen}
		>
			<ModalAppearanceContext
				value={{
					className,
					style,
					borderRadius,
					width,
					effect: effect ?? null,
				}}
			>
				<DialogPortal>
					<DialogBackdrop />
					<DialogViewport>{children}</DialogViewport>
				</DialogPortal>
			</ModalAppearanceContext>
		</BaseDialog.Root>
	);
}

export type DialogProps = DialogPopupProps;
export function Dialog({
	className,
	style,
	borderRadius,
	width,
	effect,
	...props
}: DialogProps) {
	const inherited = useContext(ModalAppearanceContext);
	return (
		<DialogPopup
			{...props}
			className={(state) => {
				const parentClassName =
					typeof inherited.className === "function"
						? inherited.className(state)
						: inherited.className;
				const merged = mergeClassName(parentClassName ?? "", className);
				return typeof merged === "function" ? merged(state) : merged;
			}}
			effect={effect === undefined ? (inherited.effect ?? null) : effect}
			style={(state) => {
				const parentStyle = mergeStyle(
					{ borderRadius: inherited.borderRadius, width: inherited.width },
					inherited.style,
				);
				const ownStyle = mergeStyle({ borderRadius, width }, style);
				return {
					...(typeof parentStyle === "function"
						? parentStyle(state)
						: parentStyle),
					...(typeof ownStyle === "function" ? ownStyle(state) : ownStyle),
				};
			}}
		/>
	);
}

export const ModalTrigger = DialogTrigger;
export {
	DialogRoot,
	DialogTrigger,
	DialogPortal,
	DialogBackdrop,
	DialogViewport,
	DialogPopup,
	DialogContent,
	DialogHeader,
	DialogBody,
	DialogFooter,
	DialogTitle,
	DialogDescription,
	DialogClose,
	createDialogHandle,
	DialogHandle,
} from "./dialog";
