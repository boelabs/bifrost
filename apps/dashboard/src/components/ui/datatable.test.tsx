import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, type Column } from "./datatable";
import assert from "node:assert/strict";
import { test } from "node:test";

const rows = Array.from({ length: 12 }, (_, index) => ({
	id: String(index),
	name: `Row ${index}`,
}));
const columns: Column<(typeof rows)[number]>[] = [
	{ key: "name", header: "Name", render: (row) => row.name },
];

test("existing tables render the full collection without client pagination", () => {
	const html = renderToStaticMarkup(
		<DataTable
			rows={rows}
			columns={columns}
			rowKey={(row) => row.id}
			caption="Models"
		/>,
	);
	assert.match(html, /<caption[^>]*>Models<\/caption>/);
	assert.match(html, />Row 11</);
	assert.doesNotMatch(html, /Next page/);
});

test("client pagination limits rows and keeps inaccessible pages disabled", () => {
	const html = renderToStaticMarkup(
		<DataTable
			rows={rows}
			columns={columns}
			rowKey={(row) => row.id}
			pagination={{ pageSize: 5 }}
		/>,
	);
	assert.match(html, />Row 4</);
	assert.doesNotMatch(html, />Row 5</);
	assert.match(html, /1–5 of 12 results/);
	assert.match(html, /<button[^>]*aria-label="Previous page"[^>]*disabled/);
});

test("empty and loading tables retain semantic status feedback", () => {
	for (const loading of [false, true]) {
		const html = renderToStaticMarkup(
			<DataTable
				rows={[]}
				columns={columns}
				rowKey={(row) => row.id}
				loading={loading}
				pagination={{}}
			/>,
		);
		assert.match(html, loading ? /Loading\.\.\./ : /No results found\./);
		assert.match(html, /0–0 of 0 results/);
		assert.match(html, /<button[^>]*aria-label="Next page"[^>]*disabled/);
	}
});

test("invalid page sizes fall back and numeric custom radii retain CSS units", () => {
	const html = renderToStaticMarkup(
		<DataTable
			rows={rows}
			columns={columns}
			rowKey={(row) => row.id}
			borderRadius={8}
			pagination={{ pageSize: 0 }}
		/>,
	);
	assert.match(html, /1–10 of 12 results/);
	assert.match(html, /--table-radius:8px/);
});
