import { composerExpanded, composerTextareaGeometry } from "./composerLayout";

import {
	useLayoutEffect,
	useCallback,
	useEffect,
	useState,
	useRef,
} from "react";

export function useComposerTextarea(prompt: string, mobile: boolean) {
	const textarea = useRef<HTMLTextAreaElement>(null);
	const [measuredHeight, setMeasuredHeight] = useState(42);
	const committedExpanded = useRef(false);
	const geometry = composerTextareaGeometry(
		prompt,
		measuredHeight,
		mobile ? 77 : 208,
	);
	const expanded = composerExpanded(
		prompt,
		geometry.contentHeight,
		committedExpanded.current,
	);

	useLayoutEffect(() => {
		committedExpanded.current = expanded;
	}, [expanded]);

	const measure = useCallback(() => {
		const element = textarea.current;
		if (!element) return;
		const previousHeight = element.style.height;
		const previousOverflowY = element.style.overflowY;
		element.style.overflowY = "hidden";
		element.style.height = "0px";
		const nextHeight = Math.max(42, element.scrollHeight);
		// Restore before Motion measures; React commits height and rail layout together.
		element.style.height = previousHeight;
		element.style.overflowY = previousOverflowY;
		setMeasuredHeight((current) =>
			current === nextHeight ? current : nextHeight,
		);
	}, []);

	useLayoutEffect(() => {
		if (textarea.current?.value === prompt) measure();
	}, [prompt, measure]);

	useEffect(() => {
		const container = textarea.current?.parentElement;
		if (!container) return;
		let frame = 0;
		let previousWidth = container.getBoundingClientRect().width;
		const observer = new ResizeObserver(([entry]) => {
			if (!entry || Math.abs(entry.contentRect.width - previousWidth) < 0.5)
				return;
			previousWidth = entry.contentRect.width;
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		});
		observer.observe(container);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [measure]);

	return { textarea, expanded, ...geometry };
}
