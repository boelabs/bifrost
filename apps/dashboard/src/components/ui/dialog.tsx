"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { cn } from "cn";

import {
	type AppearanceProps,
	overlayFadeStyles,
	type EffectProps,
	effectClassName,
	appearanceStyle,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance";

export const overlayBackdropStyles = `fixed inset-0 z-50 bg-zinc-950/50 ${overlayFadeStyles}`;
export const overlayButtonStyles = `inline-flex items-center justify-center gap-2 rounded-[var(--ui-radius-control)] px-3 py-2 text-sm font-medium text-fg hover:bg-secondary disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;
export const overlayArrowStyles =
	"size-3 rotate-45 rounded-[var(--ui-radius-sm)] border border-border/60 bg-popover data-[side=top]:-bottom-1.5 data-[side=bottom]:-top-1.5 data-[side=left]:-right-1.5 data-[side=right]:-left-1.5";
export const dialogPopupStyles = `relative flex w-full max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] flex-col gap-6 overflow-auto rounded-[var(--ui-radius-dialog)] border border-border/60 bg-popover p-6 text-fg shadow-xl outline-none ${overlayFadeStyles} md:w-md`;

export const DialogRoot = BaseDialog.Root;
export const DialogHandle = BaseDialog.Handle;
export const createDialogHandle = BaseDialog.createHandle;

export type DialogTriggerProps<Payload = unknown> =
	BaseDialog.Trigger.Props<Payload> & AppearanceProps;
export function DialogTrigger<Payload = unknown>({
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogTriggerProps<Payload>) {
	return (
		<BaseDialog.Trigger
			{...props}
			className={mergeClassName(overlayButtonStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DialogPortalProps = ComponentProps<typeof BaseDialog.Portal> &
	AppearanceProps;
export function DialogPortal({
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogPortalProps) {
	return (
		<BaseDialog.Portal
			{...props}
			className={mergeClassName("relative z-50", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DialogBackdropProps = ComponentProps<typeof BaseDialog.Backdrop> &
	AppearanceProps;
export function DialogBackdrop({
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogBackdropProps) {
	return (
		<BaseDialog.Backdrop
			{...props}
			className={mergeClassName(overlayBackdropStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DialogViewportProps = ComponentProps<typeof BaseDialog.Viewport> &
	AppearanceProps;
export function DialogViewport({
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogViewportProps) {
	return (
		<BaseDialog.Viewport
			{...props}
			className={mergeClassName(
				"fixed inset-0 z-50 flex items-center justify-center overflow-auto p-4 [scrollbar-gutter:stable]",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DialogPopupProps = ComponentProps<typeof BaseDialog.Popup> &
	AppearanceProps &
	EffectProps & {
		layout?: "content" | "sectioned";
	};
export function DialogPopup({
	layout = "content",
	effect = null,
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogPopupProps) {
	return (
		<BaseDialog.Popup
			{...props}
			className={mergeClassName(
				`${dialogPopupStyles} ${effectClassName(effect)} ${layout === "sectioned" ? "gap-0 overflow-hidden p-0" : ""}`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DialogSectionProps = ComponentProps<"div"> & AppearanceProps;

export function DialogHeader({
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogSectionProps) {
	return (
		<div
			{...props}
			className={cn(
				"shrink-0 space-y-2 border-border/50 border-b p-6",
				className,
			)}
			data-slot="dialog-header"
			style={appearanceStyle({ borderRadius, width }, style)}
		/>
	);
}

export function DialogBody({
	children,
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogSectionProps) {
	return (
		<div
			{...props}
			className={cn(
				"min-h-0 min-w-0 flex-1 scroll-p-6 overflow-y-auto overscroll-contain p-6 [scrollbar-gutter:stable]",
				className,
			)}
			data-slot="dialog-body"
			style={appearanceStyle({ borderRadius, width }, style)}
		>
			<div className="flex min-w-0 flex-col gap-5">{children}</div>
		</div>
	);
}

export function DialogFooter({
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogSectionProps) {
	return (
		<div
			{...props}
			className={cn(
				"flex shrink-0 flex-wrap items-center justify-end gap-2 border-border/50 border-t bg-popover px-6 py-4",
				className,
			)}
			data-slot="dialog-footer"
			style={appearanceStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DialogTitleProps = ComponentProps<typeof BaseDialog.Title> &
	AppearanceProps;
export function DialogTitle({
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogTitleProps) {
	return (
		<BaseDialog.Title
			{...props}
			className={mergeClassName("font-semibold text-fg text-lg", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DialogDescriptionProps = ComponentProps<
	typeof BaseDialog.Description
> &
	AppearanceProps;
export function DialogDescription({
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogDescriptionProps) {
	return (
		<BaseDialog.Description
			{...props}
			className={mergeClassName("text-fg-muted text-sm", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DialogCloseProps = ComponentProps<typeof BaseDialog.Close> &
	AppearanceProps;
export function DialogClose({
	className,
	style,
	borderRadius,
	width,
	...props
}: DialogCloseProps) {
	return (
		<BaseDialog.Close
			{...props}
			className={mergeClassName(overlayButtonStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type DialogContentProps = DialogPopupProps & {
	portalProps?: DialogPortalProps;
	backdropProps?: DialogBackdropProps;
	viewportProps?: DialogViewportProps;
};

export function DialogContent({
	portalProps,
	backdropProps,
	viewportProps,
	...props
}: DialogContentProps) {
	return (
		<DialogPortal {...portalProps}>
			<DialogBackdrop {...backdropProps} />
			<DialogViewport {...viewportProps}>
				<DialogPopup {...props} />
			</DialogViewport>
		</DialogPortal>
	);
}
