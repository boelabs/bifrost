"use client";

import { useCallback, useEffect, useState } from "react";

/** Boberth's responsive sidebar split, using the dashboard's md breakpoint. */
export function useSidebar() {
	const [collapsed, setCollapsed] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	useEffect(() => {
		const media = matchMedia("(max-width: 767px)");
		const update = () => {
			setIsMobile(media.matches);
			if (!media.matches) {
				setMobileOpen(false);
			}
		};
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	const toggle = useCallback(() => {
		if (isMobile) {
			setMobileOpen((open) => !open);
		} else {
			setCollapsed((value) => !value);
		}
	}, [isMobile]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const { target } = event;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable || target.closest("input, textarea, select"))
			) {
				return;
			}
			if (
				(event.ctrlKey || event.metaKey) &&
				!event.altKey &&
				!event.shiftKey &&
				event.key.toLowerCase() === "b"
			) {
				event.preventDefault();
				toggle();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [toggle]);
	return { collapsed, mobileOpen, setMobileOpen, toggle };
}
