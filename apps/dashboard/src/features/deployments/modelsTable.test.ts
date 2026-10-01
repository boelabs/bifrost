import { filterModelGroups, modelGroupPage } from "./modelTableState";
import { describe, expect, test } from "bun:test";
import type { Deployment } from "./common";

function deployment(id: string, patch: Partial<Deployment> = {}): Deployment {
	return {
		id,
		publicModel: "assistant",
		adapterKey: "openai",
		upstreamModel: "gpt-5.5",
		label: null,
		failureDomain: null,
		metadata: {},
		custom: false,
		catalogEntry: null,
		pricing: null,
		transportOverrides: {},
		executionPolicyOverrides: {},
		enabled: true,
		weight: 1,
		tpmLimit: null,
		rpmLimit: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...patch,
	};
}
const all = { query: "", provider: "", state: "", catalog: "" };

describe("model table groups", () => {
	test("combines search and filters without changing the full pool's routing status", () => {
		const rows = [
			deployment("a"),
			deployment("b", {
				enabled: false,
				custom: true,
				adapterKey: "openaicompatible",
				label: "Backup",
			}),
		];
		const groups = filterModelGroups(rows, {
			query: " BACKUP ",
			provider: "openaicompatible",
			state: "disabled",
			catalog: "custom",
		});
		expect(groups).toHaveLength(1);
		expect(groups[0]?.deployments.map((row) => row.id)).toEqual(["b"]);
		expect(groups[0]?.enabledCount).toBe(1);
		expect(groups[0]?.totalCount).toBe(2);
		expect(rows).toHaveLength(2);
	});

	test("searches public names, upstream names and providers and omits empty groups", () => {
		const rows = [
			deployment("a"),
			deployment("b", {
				publicModel: "writer",
				adapterKey: "anthropic",
				upstreamModel: "claude-sonnet",
			}),
		];
		for (const query of ["writer", "claude", "anthropic"]) {
			expect(
				filterModelGroups(rows, { ...all, query }).map(
					(group) => group.publicModel,
				),
			).toEqual(["writer"]);
		}
		expect(filterModelGroups(rows, { ...all, query: "missing" })).toEqual([]);
	});

	test("keeps large pools together and clamps pages after the collection shrinks", () => {
		const rows = [
			...Array.from({ length: 25 }, (_, index) => deployment(String(index))),
			deployment("writer", { publicModel: "writer" }),
		];
		const groups = filterModelGroups(rows, all);
		const first = modelGroupPage(groups, 0, 1);
		expect(first.groups[0]?.deployments).toHaveLength(25);
		expect(modelGroupPage(groups, 1, 1).groups[0]?.publicModel).toBe("writer");
		expect(modelGroupPage(groups.slice(0, 1), 5, 1).page).toBe(0);
		expect(modelGroupPage([], 5, 1)).toEqual({
			page: 0,
			pageCount: 1,
			start: 0,
			end: 0,
			groups: [],
		});
	});
});
