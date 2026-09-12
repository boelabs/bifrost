"use client";

import { type AppearanceProps, mergeClassName, mergeStyle } from "./appearance";
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { overlayButtonStyles } from "./dialog";

export {
	DialogBackdrop as AlertDialogBackdrop,
	DialogClose as AlertDialogClose,
	DialogContent as AlertDialogContent,
	DialogDescription as AlertDialogDescription,
	DialogPopup as AlertDialogPopup,
	DialogPortal as AlertDialogPortal,
	DialogTitle as AlertDialogTitle,
	DialogViewport as AlertDialogViewport,
} from "./dialog";
export type {
	DialogBackdropProps as AlertDialogBackdropProps,
	DialogCloseProps as AlertDialogCloseProps,
	DialogContentProps as AlertDialogContentProps,
	DialogDescriptionProps as AlertDialogDescriptionProps,
	DialogPopupProps as AlertDialogPopupProps,
	DialogPortalProps as AlertDialogPortalProps,
	DialogTitleProps as AlertDialogTitleProps,
	DialogViewportProps as AlertDialogViewportProps,
} from "./dialog";

export const AlertDialogRoot = BaseAlertDialog.Root;
export const AlertDialog = BaseAlertDialog.Root;
export const AlertDialogHandle = BaseAlertDialog.Handle;
export const createAlertDialogHandle = BaseAlertDialog.createHandle;

export type AlertDialogTriggerProps<Payload = unknown> =
	BaseAlertDialog.Trigger.Props<Payload> & AppearanceProps;
export function AlertDialogTrigger<Payload = unknown>({
	className,
	style,
	borderRadius,
	width,
	...props
}: AlertDialogTriggerProps<Payload>) {
	return (
		<BaseAlertDialog.Trigger
			{...props}
			className={mergeClassName(overlayButtonStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
