import type { ReactNode } from "react";

export interface DetailItem {
	/** Unique within its list: it names the row for the reader and for React. */
	label: string;
	value: ReactNode;
}

/** Label/value pairs for a record's page; an empty value reads as an em dash. */
export function DetailList({ items }: { items: DetailItem[] }) {
	return (
		<dl className="grid gap-3 text-sm">
			{items.map((item) => (
				<div
					className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-baseline gap-3"
					key={item.label}
				>
					<dt className="text-muted-foreground">{item.label}</dt>
					<dd className="min-w-0 break-words text-foreground">
						{item.value ?? "—"}
					</dd>
				</div>
			))}
		</dl>
	);
}
