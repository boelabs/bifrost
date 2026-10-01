import type { Deployment } from "./common";

export interface ModelFilters {
	query: string;
	provider: string;
	state: string;
}

export type ModelSort = "publicModel" | "createdAt" | "updatedAt";

export function filterModelRows(rows: Deployment[], filters: ModelFilters) {
	const query = filters.query.trim().toLocaleLowerCase();
	return rows.filter(
		(row) =>
			(!filters.provider || row.adapterKey === filters.provider) &&
			(!filters.state || row.enabled === (filters.state === "enabled")) &&
			(!query ||
				[
					row.id,
					row.publicModel,
					row.upstreamModel,
					row.adapterKey,
					row.label ?? "",
				].some((value) => value.toLocaleLowerCase().includes(query))),
	);
}

export function sortModelRows(
	rows: Deployment[],
	key: ModelSort,
	descending: boolean,
) {
	return [...rows].sort((a, b) => {
		const comparison =
			key === "publicModel"
				? a.publicModel.localeCompare(b.publicModel) ||
					a.upstreamModel.localeCompare(b.upstreamModel) ||
					a.adapterKey.localeCompare(b.adapterKey)
				: Date.parse(a[key]) - Date.parse(b[key]);
		return (comparison || a.id.localeCompare(b.id)) * (descending ? -1 : 1);
	});
}

export function modelRowPage<T>(
	rows: T[],
	requestedPage: number,
	pageSize = 10,
) {
	const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
	const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
	return {
		page,
		pageCount,
		start: rows.length ? page * pageSize + 1 : 0,
		end: Math.min((page + 1) * pageSize, rows.length),
		rows: rows.slice(page * pageSize, (page + 1) * pageSize),
	};
}
