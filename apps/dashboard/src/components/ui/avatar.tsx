"use client";

import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { tv } from "tailwind-variants";

import {
	type AppearanceProps,
	mergeClassName,
	type UISize,
	mergeStyle,
} from "./appearance";

export type AvatarRootProps = BaseAvatar.Root.Props &
	AppearanceProps & { size?: UISize };
export type AvatarImageProps = BaseAvatar.Image.Props & AppearanceProps;
export type AvatarFallbackProps = BaseAvatar.Fallback.Props & AppearanceProps;

const avatarStyles = tv({
	base: "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-secondary-fg ring-1 ring-border/60",
	variants: {
		size: {
			xs: "size-6 text-xs",
			sm: "size-8 text-xs",
			md: "size-10 text-sm",
			lg: "size-12 text-base",
		},
	},
	defaultVariants: { size: "md" },
});

export function AvatarRoot({
	className,
	style,
	borderRadius,
	width,
	size = "md",
	...props
}: AvatarRootProps) {
	return (
		<BaseAvatar.Root
			{...props}
			className={mergeClassName(avatarStyles({ size }), className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function AvatarImage({
	className,
	style,
	borderRadius,
	width,
	...props
}: AvatarImageProps) {
	return (
		<BaseAvatar.Image
			{...props}
			className={mergeClassName(
				"size-full rounded-[inherit] object-cover",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function AvatarFallback({
	className,
	style,
	borderRadius,
	width,
	...props
}: AvatarFallbackProps) {
	return (
		<BaseAvatar.Fallback
			{...props}
			className={mergeClassName(
				"flex size-full items-center justify-center rounded-[inherit] bg-secondary font-semibold text-secondary-fg",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export const Avatar = {
	Root: AvatarRoot,
	Image: AvatarImage,
	Fallback: AvatarFallback,
};
