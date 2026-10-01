import { type AppearanceProps, appearanceStyle } from "./appearance";
import type { ComponentProps } from "react";

import {
	TableHead as TableHeadPrimitive,
	Table as TablePrimitive,
} from "./primitives/table";

export interface TableProps
	extends Omit<ComponentProps<typeof TablePrimitive>, "width">,
		AppearanceProps {}

export function Table({ borderRadius, width, style, ...props }: TableProps) {
	return (
		<TablePrimitive
			{...props}
			style={appearanceStyle({ borderRadius, width }, style)}
		/>
	);
}

export function TableHead({ scope = "col", ...props }: ComponentProps<"th">) {
	return <TableHeadPrimitive {...props} scope={scope} />;
}

export const TableColumn = TableHead;

export {
	TableHeader,
	TableBody,
	TableFooter,
	TableRow,
	TableCell,
	TableCaption,
} from "./primitives/table";
