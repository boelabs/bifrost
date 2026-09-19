"use client";

import { overlayButtonStyles, overlayArrowStyles } from "./dialog";
import { Toast as BaseToast } from "@base-ui/react/toast";
import type { ComponentProps } from "react";

import {
	type AppearanceProps,
	overlayFadeStyles,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance";

export const ToastProvider = BaseToast.Provider;
export const { useToastManager } = BaseToast;
export const { createToastManager } = BaseToast;

export type ToastPortalProps = ComponentProps<typeof BaseToast.Portal> &
	AppearanceProps;
export function ToastPortal({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToastPortalProps) {
	return (
		<BaseToast.Portal
			{...props}
			className={mergeClassName("relative z-[100]", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type ToastViewportProps = ComponentProps<typeof BaseToast.Viewport> &
	AppearanceProps;
export function ToastViewport({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToastViewportProps) {
	return (
		<BaseToast.Viewport
			{...props}
			className={mergeClassName(
				"fixed right-4 bottom-4 z-[100] flex w-88 max-w-[calc(100vw-2rem)] flex-col gap-3 outline-none",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type ToastRootProps = ComponentProps<typeof BaseToast.Root> &
	AppearanceProps;
export function ToastRoot({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToastRootProps) {
	return (
		<BaseToast.Root
			{...props}
			className={mergeClassName(
				`${overlayFadeStyles} relative flex w-full shrink-0 flex-col gap-3 rounded-(--ui-radius-dialog) border border-border/60 bg-surface p-4 pr-10 text-fg shadow-xl outline-none transition-[opacity,transform] data-[limited]:hidden data-[swiping]:select-none data-[type=error]:border-danger/50 data-[type=success]:border-success/50 data-[swiping]:transition-none`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, (state) => ({
				transform:
					"translate(var(--toast-swipe-movement-x, 0px), var(--toast-swipe-movement-y, 0px))",
				...(typeof style === "function" ? style(state) : style),
			}))}
		/>
	);
}

export type ToastContentProps = ComponentProps<typeof BaseToast.Content> &
	AppearanceProps;
export function ToastContent({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToastContentProps) {
	return (
		<BaseToast.Content
			{...props}
			className={mergeClassName("flex min-w-0 flex-col gap-1", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type ToastTitleProps = ComponentProps<typeof BaseToast.Title> &
	AppearanceProps;
export function ToastTitle({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToastTitleProps) {
	return (
		<BaseToast.Title
			{...props}
			className={mergeClassName("font-semibold text-fg text-sm", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type ToastDescriptionProps = ComponentProps<
	typeof BaseToast.Description
> &
	AppearanceProps;
export function ToastDescription({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToastDescriptionProps) {
	return (
		<BaseToast.Description
			{...props}
			className={mergeClassName("text-fg-muted text-sm", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type ToastCloseProps = ComponentProps<typeof BaseToast.Close> &
	AppearanceProps;
export function ToastClose({
	className,
	style,
	borderRadius,
	width,
	children = "×",
	...props
}: ToastCloseProps) {
	return (
		<BaseToast.Close
			aria-label="Dismiss notification"
			{...props}
			className={mergeClassName(
				`absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-(--ui-radius-control) text-fg-muted hover:bg-secondary hover:text-fg ${focusRing}`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children}
		</BaseToast.Close>
	);
}

export type ToastActionProps = ComponentProps<typeof BaseToast.Action> &
	AppearanceProps;
export function ToastAction({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToastActionProps) {
	return (
		<BaseToast.Action
			{...props}
			className={mergeClassName(
				`${overlayButtonStyles} self-start border border-border`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type ToastPositionerProps = ComponentProps<typeof BaseToast.Positioner> &
	AppearanceProps;
export function ToastPositioner({
	className,
	style,
	borderRadius,
	width,
	sideOffset = 8,
	...props
}: ToastPositionerProps) {
	return (
		<BaseToast.Positioner
			{...props}
			className={mergeClassName(
				"z-[100] w-80 max-w-[calc(100vw-2rem)] outline-none",
				className,
			)}
			sideOffset={sideOffset}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type ToastArrowProps = ComponentProps<typeof BaseToast.Arrow> &
	AppearanceProps;
export function ToastArrow({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToastArrowProps) {
	return (
		<BaseToast.Arrow
			{...props}
			className={mergeClassName(overlayArrowStyles, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export type ToasterProps = ToastViewportProps & {
	portalProps?: ToastPortalProps;
	toastProps?: Omit<ToastRootProps, "toast" | "children">;
};
export function Toaster({ portalProps, toastProps, ...props }: ToasterProps) {
	const { toasts } = useToastManager();
	return (
		<ToastPortal {...portalProps}>
			<ToastViewport {...props}>
				{toasts.map((toast) => {
					const content = (
						<ToastRoot key={toast.id} {...toastProps} toast={toast}>
							<ToastContent>
								<ToastTitle>{toast.title}</ToastTitle>
								{toast.description ? (
									<ToastDescription>{toast.description}</ToastDescription>
								) : null}
							</ToastContent>
							{toast.actionProps ? (
								<ToastAction {...toast.actionProps} />
							) : null}
							<ToastClose />
						</ToastRoot>
					);
					return toast.positionerProps ? (
						<ToastPositioner
							key={toast.id}
							{...toast.positionerProps}
							toast={toast}
						>
							{content}
						</ToastPositioner>
					) : (
						content
					);
				})}
			</ToastViewport>
		</ToastPortal>
	);
}
