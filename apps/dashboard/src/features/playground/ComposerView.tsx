"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { useMobileComposer } from "./useMobileComposer";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "cn";

import {
	COMPOSER_REDUCED_MOTION_TRANSITION,
	COMPOSER_SURFACE_RADIUS_PX,
	COMPOSER_LAYOUT_TRANSITION,
} from "./composerLayout";

export type ComposerLayoutState = "compact" | "expanded";

export interface ComposerViewProps {
	state?: ComposerLayoutState;
	topSection?: ReactNode;
	textarea: ReactNode;
	leftActions: ReactNode;
	footer?: ReactNode;
	rightActions: ReactNode;
	supportingContent?: ReactNode;

	statusBar?: ReactNode;
	topSectionLayoutKey?: string | number;
	onSurfaceClick?: MouseEventHandler<HTMLFieldSetElement>;
	className?: string;
}

const COMPOSER_ACTION_SLOT_CLASS_NAME =
	"flex h-9 min-w-0 self-center items-center gap-1";
const COMPOSER_ATTACHMENTS_SELECTOR = '[data-composer-attachments="true"]';
const COMPOSER_FOCUS_EXCLUSION_SELECTOR = [
	"button",
	"a",
	"input",
	"textarea",
	"select",
	'[contenteditable="true"]',
	'[role="button"]',
	'[role="link"]',
	'[data-composer-focus-exclude="true"]',
].join(",");

export function ComposerView({
	state = "compact",
	topSection,
	textarea,
	leftActions,
	footer,
	rightActions,
	supportingContent,
	statusBar,
	topSectionLayoutKey,
	onSurfaceClick,
	className,
}: ComposerViewProps) {
	const hasTopSection = topSection != null;
	const isExpanded = state === "expanded";
	const layoutDependency = `${state}:${hasTopSection ? "context" : "plain"}:${topSectionLayoutKey ?? ""}`;
	const shouldReduceMotion = useReducedMotion();
	const isMobileLayout = useMobileComposer();
	const shouldAnimateLayout = !isMobileLayout;
	const layoutTransition = shouldReduceMotion
		? COMPOSER_REDUCED_MOTION_TRANSITION
		: COMPOSER_LAYOUT_TRANSITION;

	const handleSurfaceClick: MouseEventHandler<HTMLFieldSetElement> = (
		event,
	) => {
		const target = event.target;

		if (!(target instanceof Element)) {
			return;
		}

		const attachmentContainer = target.closest(COMPOSER_ATTACHMENTS_SELECTOR);
		const isAttachmentContent =
			attachmentContainer != null && target !== attachmentContainer;

		if (
			isAttachmentContent ||
			target.closest(COMPOSER_FOCUS_EXCLUSION_SELECTOR)
		) {
			return;
		}

		onSurfaceClick?.(event);
	};

	return (
		<>
			<div
				data-expanded={isExpanded ? "" : undefined}
				className={cn(
					"group/composer relative isolate flex w-full flex-col",
					className,
				)}
			>
				<div className="relative isolate z-10 w-full">
					<motion.div
						aria-hidden="true"
						layout={shouldAnimateLayout}
						layoutDependency={layoutDependency}
						data-composer-surface="true"
						transition={layoutTransition}
						style={{ borderRadius: COMPOSER_SURFACE_RADIUS_PX }}
						className="pointer-events-none absolute inset-0 z-0 overflow-clip bg-surface-2 bg-clip-padding shadow-sm max-sm:hidden"
					/>

					<motion.div
						aria-hidden="true"
						layout={shouldAnimateLayout}
						layoutDependency={layoutDependency}
						data-composer-outline="true"
						transition={layoutTransition}
						style={{
							borderRadius: COMPOSER_SURFACE_RADIUS_PX,
							boxShadow: "inset 0 0 0 1px var(--color-border)",
						}}
						className="pointer-events-none absolute inset-0 z-20 max-sm:hidden"
					/>

					<fieldset
						aria-label="Compose a message"
						onClick={handleSurfaceClick}
						onKeyDown={(event) => {
							if (event.target === event.currentTarget && event.key === "Enter")
								event.currentTarget.querySelector("textarea")?.focus();
						}}
						data-composer-layout={isExpanded ? "expanded" : "compact"}
						style={{ borderRadius: COMPOSER_SURFACE_RADIUS_PX }}
						className={cn(
							"m-0 min-w-0 border-0 relative z-10 grid w-full cursor-text grid-cols-[auto_minmax(0,1fr)_auto] overflow-visible px-2 pt-2.5 pb-2 text-fg contain-inline-size max-sm:p-2",
							"[grid-template-areas:'header_header_header'_'leading_primary_trailing'_'._footer_.']",
							"sm:grid-rows-[auto_minmax(42px,auto)_auto] motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-in-out",
							"max-sm:overflow-hidden max-sm:border max-sm:border-border max-sm:bg-surface-2 max-sm:shadow-none max-sm:transition-none",
							!isExpanded && "min-h-13 py-1.25",
							isExpanded &&
								"[grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing']",
							"max-sm:[grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing']",
						)}
					>
						{hasTopSection ? (
							<motion.div
								layout={shouldAnimateLayout ? "position" : false}
								layoutDependency={layoutDependency}
								transition={layoutTransition}
								data-composer-transition-slot="header"
								className={cn(
									"-mx-2 mb-2.5 flex min-w-0 flex-col [grid-area:header]",
									isExpanded ? "-mt-2.25" : "-mt-1.25",
								)}
							>
								{topSection}
							</motion.div>
						) : null}

						<motion.div
							layout={shouldAnimateLayout ? "position" : false}
							layoutDependency={layoutDependency}
							transition={layoutTransition}
							data-composer-transition-slot="leading"
							className={cn(
								COMPOSER_ACTION_SLOT_CLASS_NAME,
								"[grid-area:leading]",
							)}
						>
							{leftActions}
						</motion.div>

						<motion.div
							layout={shouldAnimateLayout ? "position" : false}
							layoutDependency={layoutDependency}
							transition={layoutTransition}
							data-composer-transition-slot="primary"
							className={cn(
								"-my-2.5 flex min-h-14 min-w-0 items-center overflow-x-hidden ps-1.75 pe-1.5 [grid-area:primary]",
								isExpanded && "mb-0 ps-2.5 pe-2.5",
								"max-sm:mb-0 max-sm:ps-2.5 max-sm:pe-2.5",
							)}
						>
							{textarea}
						</motion.div>

						<motion.div className="min-w-0 self-center [grid-area:footer]">
							{footer}
						</motion.div>

						<motion.div
							layout={shouldAnimateLayout ? "position" : false}
							layoutDependency={layoutDependency}
							transition={layoutTransition}
							data-composer-transition-slot="trailing"
							className={cn(
								COMPOSER_ACTION_SLOT_CLASS_NAME,
								"[grid-area:trailing]",
							)}
						>
							{rightActions}
						</motion.div>
					</fieldset>
				</div>

				{statusBar}

				{supportingContent != null ? (
					<motion.div
						layout={shouldAnimateLayout ? "position" : false}
						layoutDependency={layoutDependency}
						transition={layoutTransition}
						data-composer-transition-slot="supporting"
						className="min-w-0"
					>
						{supportingContent}
					</motion.div>
				) : null}
			</div>
		</>
	);
}
