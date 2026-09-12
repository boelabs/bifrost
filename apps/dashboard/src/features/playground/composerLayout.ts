import type { Transition } from "motion/react";

export const COMPOSER_SURFACE_RADIUS_PX = 28;
export const COMPOSER_LAYOUT_TRANSITION: Transition = {
	layout: { type: "spring", stiffness: 800, damping: 51, mass: 1 },
};
export const COMPOSER_REDUCED_MOTION_TRANSITION: Transition = {
	layout: { duration: 0 },
};

export function composerExpanded(
	input: string,
	height: number,
	previous: boolean,
) {
	return input.length > 0 && (previous || height > 42);
}

export function composerTextareaGeometry(
	prompt: string,
	measuredHeight: number,
	maximum: number,
) {
	const contentHeight = prompt.length === 0 ? 42 : Math.max(42, measuredHeight);
	return {
		contentHeight,
		height: Math.min(contentHeight, maximum),
		overflowY:
			contentHeight > maximum ? ("auto" as const) : ("hidden" as const),
	};
}
