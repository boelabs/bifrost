import Image from "next/image";

/**
 * The Bifrost mark: the rainbow bridge, drawn as one colour on transparency.
 *
 * Served as a file rather than inlined, so it stays out of the JavaScript bundle and is cached once
 * for every page that draws it. That rules out `currentColor` — an `<img>` is its own document and
 * inherits nothing — so the theme is a filter instead: the ink is black as drawn, and inverted to
 * white on a dark background. A single-colour mark is exactly the case where that is faithful
 * rather than a trick.
 *
 * The artwork is wider than it is tall (1063 × 677), so `size` is its HEIGHT and the width follows;
 * asking for a square would letterbox it inside its own box.
 *
 * It carries the product's name as its alt text, because where this is drawn the name is not
 * written anywhere else — the mark is not decoration here, it is the only thing saying which
 * application this is.
 */
export function BifrostMark({
	size = 18,
	className = "",
}: {
	size?: number;
	className?: string;
}) {
	return (
		<Image
			alt="Bifrost"
			className={`dark:invert ${className}`}
			height={size}
			priority
			src="/logo.svg"
			width={Math.round((size * 1063) / 677)}
		/>
	);
}
