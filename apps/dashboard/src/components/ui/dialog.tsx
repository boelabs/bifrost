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

export const overlayBackdropStyles = `fixed inset-0 z-50 bg-black/32 backdrop-blur-sm ${overlayFadeStyles}`;
export const overlayButtonStyles = `inline-flex items-center justify-center gap-2 rounded-(--ui-radius-control) px-3 py-2 text-sm font-medium text-fg hover:bg-secondary disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;
export const overlayArrowStyles =
	"size-3 rotate-45 rounded-(--ui-radius-sm) border border-border/60 bg-popover data-[side=top]:-bottom-1.5 data-[side=bottom]:-top-1.5 data-[side=left]:-right-1.5 data-[side=right]:-left-1.5";
export const dialogPopupStyles =
	"relative row-start-2 flex max-h-full min-h-0 w-full min-w-0 max-w-lg origin-center flex-col rounded-2xl border bg-popover not-dark:bg-clip-padding text-popover-foreground opacity-[calc(1-var(--nested-dialogs))] shadow-lg/5 outline-none transition-[scale,opacity,translate] duration-200 ease-in-out will-change-transform before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:opacity-0 data-starting-style:opacity-0 sm:scale-[calc(1-0.1*var(--nested-dialogs))] sm:data-ending-style:scale-98 sm:data-starting-style:scale-98 dark:before:shadow-[0_-1px_--theme(--color-white/6%)] overflow-auto gap-6 p-6 max-sm:max-w-none max-sm:origin-bottom max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4 max-sm:before:hidden motion-reduce:transition-none";

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
				"fixed inset-0 z-50 grid grid-rows-[1fr_auto_3fr] justify-items-center p-4 max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12",
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
			className={cn("flex shrink-0 flex-col gap-2 p-6 pb-3", className)}
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
				"scrollbar-gutter-stable min-h-0 min-w-0 flex-1 scroll-p-6 overflow-y-auto overscroll-contain p-6",
				className,
			)}
			data-slot="dialog-body"
			style={appearanceStyle({ borderRadius, width }, style)}
		>
			<div className="flex min-w-0 flex-col gap-4">{children}</div>
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
				"flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-muted/72 px-6 py-4 max-sm:flex-col-reverse max-sm:items-stretch",
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
			className={mergeClassName(
				"font-semibold text-foreground text-xl leading-none",
				className,
			)}
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
