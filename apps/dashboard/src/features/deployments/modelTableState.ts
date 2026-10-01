import { type Deployment, groupByPublicModel } from "./common";

export interface ModelFilters {
	query: string;
	provider: string;
	state: string;
	catalog: string;
}

export function filterModelGroups(rows: Deployment[], filters: ModelFilters) {
	const query = filters.query.trim().toLocaleLowerCase();
	return groupByPublicModel(rows).flatMap((group) => {
		const deployments = group.deployments.filter(
			(row) =>
				(!filters.provider || row.adapterKey === filters.provider) &&
				(!filters.state || row.enabled === (filters.state === "enabled")) &&
				(!filters.catalog || row.custom === (filters.catalog === "custom")) &&
				(!query ||
					[
						row.publicModel,
						row.upstreamModel,
						row.adapterKey,
						row.label ?? "",
					].some((value) => value.toLocaleLowerCase().includes(query))),
		);
		return deployments.length
			? [{ ...group, totalCount: group.deployments.length, deployments }]
			: [];
	});
}

export function modelGroupPage<T>(
	groups: T[],
	requestedPage: number,
	pageSize = 10,
) {
	const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));
	const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
	return {
		page,
		pageCount,
		start: groups.length ? page * pageSize + 1 : 0,
		end: Math.min((page + 1) * pageSize, groups.length),
		groups: groups.slice(page * pageSize, (page + 1) * pageSize),
	};
}
