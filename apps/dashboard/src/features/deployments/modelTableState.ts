import type { Deployment } from "./common";

export interface ModelFilters {
	query: string;
	provider: string;
	state: string;
}

/** The list's orders, as its order select offers them; the first is the default. */
export const MODEL_ORDERS = [
	{ value: "model", label: "Model (A–Z)" },
	{ value: "newest", label: "Newest" },
	{ value: "oldest", label: "Oldest" },
	{ value: "updated", label: "Recently updated" },
] as const;

export type ModelOrder = (typeof MODEL_ORDERS)[number]["value"];

export function isModelOrder(value: string): value is ModelOrder {
	return MODEL_ORDERS.some((order) => order.value === value);
}

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

function byName(a: Deployment, b: Deployment) {
	return (
		a.publicModel.localeCompare(b.publicModel) ||
		a.upstreamModel.localeCompare(b.upstreamModel) ||
		a.adapterKey.localeCompare(b.adapterKey)
	);
}

const COMPARE: Record<ModelOrder, (a: Deployment, b: Deployment) => number> = {
	model: byName,
	newest: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
	oldest: (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
	updated: (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
};

/** A sorted copy; ties fall back to the id, so the order is stable across reloads. */
export function sortModelRows(rows: Deployment[], order: ModelOrder) {
	const compare = COMPARE[order];
	return [...rows].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
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
