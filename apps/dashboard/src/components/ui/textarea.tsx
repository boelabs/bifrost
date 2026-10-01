"use client";

import { mergeClassName } from "./appearance";
import type { InputProps } from "./input";
import { Input } from "./input";

export interface TextareaProps extends Omit<InputProps, "type" | "render"> {
	rows?: number;
	cols?: number;
}

export function Textarea({
	rows = 4,
	cols,
	className,
	...props
}: TextareaProps) {
	return (
		<Input
			{...props}
			className={mergeClassName(
				"field-sizing-content h-auto min-h-17.5 py-[calc(--spacing(1.5)-1px)] leading-normal max-sm:min-h-20.5 sm:h-auto sm:leading-normal",
				className,
			)}
			render={<textarea cols={cols} rows={rows} />}
		/>
	);
}
