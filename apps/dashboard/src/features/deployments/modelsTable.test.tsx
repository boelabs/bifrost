import { describe, expect, test } from "bun:test";
import type { Deployment } from "./common";

import {
	filterModelRows,
	sortModelRows,
	modelRowPage,
} from "./modelTableState";

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
const all = { query: "", provider: "", state: "" };

describe("model table rows", () => {
	test("combines search and filters without changing the complete routing pool", () => {
		const rows = [
			deployment("a"),
			deployment("b", {
				enabled: false,
				adapterKey: "openaicompatible",
				label: "Backup",
			}),
		];
		expect(
			filterModelRows(rows, {
				query: " BACKUP ",
				provider: "openaicompatible",
				state: "disabled",
			}).map((row) => row.id),
		).toEqual(["b"]);
		expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
		expect(rows[0]?.enabled).toBe(true);
	});

	test("searches public names, upstream names, providers and internal ids", () => {
		const rows = [
			deployment("a"),
			deployment("writer-id", {
				publicModel: "writer",
				adapterKey: "anthropic",
				upstreamModel: "claude-sonnet",
			}),
		];
		for (const query of ["writer", "claude", "anthropic", "writer-id"]) {
			expect(
				filterModelRows(rows, { ...all, query }).map((row) => row.id),
			).toEqual(["writer-id"]);
		}
		expect(filterModelRows(rows, { ...all, query: "missing" })).toEqual([]);
	});

	test("paginates deployments even when they share one public name", () => {
		const rows = Array.from({ length: 25 }, (_, index) =>
			deployment(String(index)),
		);
		expect(modelRowPage(rows, 0).rows).toHaveLength(10);
		expect(modelRowPage(rows, 1).rows.map((row) => row.id)).toEqual(
			Array.from({ length: 10 }, (_, index) => String(index + 10)),
		);
		expect(modelRowPage(rows, 2).rows).toHaveLength(5);
		expect(modelRowPage(rows, 0, 25).rows).toHaveLength(25);
		expect(modelRowPage(rows.slice(0, 1), 5).page).toBe(0);
		expect(modelRowPage([], 5)).toEqual({
			page: 0,
			pageCount: 1,
			start: 0,
			end: 0,
			rows: [],
		});
	});

	test("sorts public names and timestamps without mutating rows", () => {
		const rows = [
			deployment("a", {
				publicModel: "writer",
				createdAt: "2026-02-01T00:00:00Z",
			}),
			deployment("b"),
			deployment("c", { upstreamModel: "gpt-4.1" }),
		];
		expect(
			sortModelRows(rows, "publicModel", false).map((row) => row.id),
		).toEqual(["c", "b", "a"]);
		expect(sortModelRows(rows, "createdAt", true)[0]?.id).toBe("a");
		expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
	});
});

import { renderToStaticMarkup } from "react-dom/server";
import { ModelsTable } from "./ModelsTable";

test("renders one ordinary table row per deployment with repeated public context", () => {
	const html = renderToStaticMarkup(
		<ModelsTable
			deployments={[
				deployment("12345678-first"),
				deployment("23456789-second"),
			]}
		/>,
	);
	expect(html.match(/<table\b/g)).toHaveLength(1);
	expect(html.match(/<tr\b/g)).toHaveLength(3);
	expect(html.match(/>assistant</g)).toHaveLength(2);
	expect(html.match(/>gpt-5.5</g)).toHaveLength(2);
	expect(html).toContain("12345678…");
	expect(html).toContain("1–2 of 2 deployments");
	expect(html).not.toContain("colspan");
	expect(html).not.toContain(">Weight<");
	expect(html).not.toContain(">Catalog<");
});

test("loading mirrors flat rows and exposes one loading announcement", () => {
	const html = renderToStaticMarkup(<ModelsTable loading />);
	expect(html.match(/<tr\b/g)).toHaveLength(6);
	expect(html).toContain("Loading models");
	expect(html).toContain("inert");
	expect(html).not.toContain("colspan");
});

test("an empty collection retains the table headers and navigation", () => {
	const html = renderToStaticMarkup(<ModelsTable />);
	expect(html).toContain("No deployments yet");
	expect(html).toContain("0–0 of 0 deployments");
	expect(html.match(/<table\b/g)).toHaveLength(1);
	expect(html).toContain("Deployment ID");
});
