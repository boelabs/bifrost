"use client";

import type { InputProps } from "./input";
import { Input } from "./input";

export interface TextareaProps extends Omit<InputProps, "type" | "render"> {
	rows?: number;
	cols?: number;
}

export function Textarea({ rows = 4, cols, ...props }: TextareaProps) {
	return <Input {...props} render={<textarea cols={cols} rows={rows} />} />;
}
