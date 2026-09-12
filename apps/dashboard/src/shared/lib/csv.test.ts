import { describe, expect, test } from "bun:test";
import { type CsvColumn, toCsv } from "./csv.ts";

interface Row {
	model: string;
	cost: number | null;
	note: string;
}

const columns: CsvColumn<Row>[] = [
	["model", (row) => row.model],
	["cost", (row) => row.cost],
	["note", (row) => row.note],
];

describe("toCsv", () => {
	test("writes a header and one line per row", () => {
		const csv = toCsv([{ model: "general", cost: 12, note: "ok" }], columns);
		expect(csv).toBe("model,cost,note\r\ngeneral,12,ok");
	});

	test("quotes separators and newlines instead of shifting columns", () => {
		const csv = toCsv(
			[{ model: "a,b", cost: null, note: 'said "no"\nagain' }],
			columns,
		);
		expect(csv).toBe('model,cost,note\r\n"a,b",,"said ""no""\nagain"');
	});

	test("an empty table still carries its header", () => {
		expect(toCsv([], columns)).toBe("model,cost,note");
	});
});
