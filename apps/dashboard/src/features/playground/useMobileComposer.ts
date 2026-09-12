import { useSyncExternalStore } from "react";

const query = "(max-width: 639px)";
function subscribe(onChange: () => void) {
	const media = window.matchMedia(query);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}
export function useMobileComposer() {
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(query).matches,
		() => false,
	);
}
