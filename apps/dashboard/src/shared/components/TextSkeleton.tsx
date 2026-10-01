import { Skeleton } from "#/components/ui/primitives/skeleton";

const PLACEHOLDER = "aeiou ".repeat(100);

export function placeholderText(length: number) {
	return PLACEHOLDER.slice(0, length).trimEnd();
}

export function SampleSkeleton({ children }: { children: string }) {
	return (
		<Skeleton
			aria-hidden="true"
			className="w-fit max-w-full select-none box-decoration-clone text-transparent"
			render={<span />}
		>
			{children}
		</Skeleton>
	);
}

/** Transparent text as long as the real one, so it takes the same lines at every width. */
export function TextSkeleton({ length }: { length: number }) {
	return <SampleSkeleton>{placeholderText(length)}</SampleSkeleton>;
}

/**
 * Stands in for an ID as the API makes them (a prefix of `prefix` letters, `_` and a UUID): the
 * same number of characters, breaking only at the same hyphens.
 */
export function IdSkeleton({ prefix = 3 }: { prefix?: number }) {
	return (
		<SampleSkeleton>{`${"e".repeat(prefix)}_eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee`}</SampleSkeleton>
	);
}

export function StackedTextSkeleton() {
	return (
		<span className="flex flex-col">
			<TextSkeleton length={16} />
			<span className="text-xs">
				<TextSkeleton length={24} />
			</span>
		</span>
	);
}
