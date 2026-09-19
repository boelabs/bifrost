import type { CSSProperties } from "react";

// Square 1 diagonal sweep: https://dotmatrix.zzzzshawn.cloud/getting-started/manual
const dots = Array.from({ length: 25 }, (_, index) => {
	const slice = Math.floor(index / 5) + (4 - (index % 5));
	return { index, path: slice / 8, parity: slice % 2 };
});

export function ResponseLoader() {
	return (
		<div className="flex h-7 items-center text-fg-muted" role="status">
			<span aria-hidden="true" className="playground-dotmatrix">
				{dots.map(({ index, path, parity }) => (
					<span
						className="playground-dotmatrix-dot"
						key={index}
						style={
							{
								"--dot-delay": `${(path * 0.2 + parity * 0.5) * 1500}ms`,
								"--dot-rest": parity === 0 ? 0.88 : 0.14,
							} as CSSProperties
						}
					/>
				))}
			</span>
			<span className="sr-only">Generating response...</span>
		</div>
	);
}
