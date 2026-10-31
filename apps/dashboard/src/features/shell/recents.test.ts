import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type RecentPage,
	RECENT_LIMIT,
	isRecordPath,
	parseRecent,
	recordVisit,
	togglePin,
	isPinned,
	areaOf,
} from "./recents.ts";

const page = (index: number, pinned = false): RecentPage => ({
	href: `/models/dep_${index}`,
	title: `Model ${index}`,
	pinned,
});

test("the latest visit goes first, once, and the oldest falls off past the limit", () => {
	const pages = [1, 2, 3, 4, 5, 6, 7, 2]
		.map((index) => page(index))
		.reduce<RecentPage[]>(recordVisit, []);
	assert.deepEqual(
		pages.map((item) => item.title),
		["Model 2", "Model 7", "Model 6", "Model 5", "Model 4", "Model 3"],
	);
	assert.equal(pages.length, RECENT_LIMIT);
});

test("pinned pages keep the order they were pinned in, never moved by a visit", () => {
	const pinned = [page(1), page(3)].reduce(togglePin, [page(2), page(1)]);
	assert.deepEqual(
		pinned.map((item) => [item.title, item.pinned]),
		[
			["Model 1", true],
			["Model 3", true],
			["Model 2", false],
		],
	);
	const visited = [4, 5, 6, 7, 8, 9, 10, 3]
		.map((index) => page(index))
		.reduce(recordVisit, pinned);
	assert.deepEqual(
		visited.filter((item) => item.pinned).map((item) => item.title),
		["Model 1", "Model 3"],
	);
	assert.equal(visited.filter((item) => !item.pinned).length, RECENT_LIMIT);
	const renamed = recordVisit(visited, { href: page(1).href, title: "gpt-5" });
	assert.deepEqual(renamed[0], {
		href: page(1).href,
		title: "gpt-5",
		pinned: true,
	});
	assert.equal(isPinned(renamed, page(1).href), true);
	assert.equal(isPinned(renamed, page(10).href), false);
});

test("unpinning puts a page back at the head of the latest", () => {
	const pages = togglePin([page(1, true), page(2, true), page(3)], page(1));
	assert.deepEqual(
		pages.map((item) => [item.title, item.pinned]),
		[
			["Model 2", true],
			["Model 1", false],
			["Model 3", false],
		],
	);
});

test("a record not remembered yet can be pinned", () => {
	assert.deepEqual(togglePin([page(2)], page(1)), [
		{ ...page(1), pinned: true },
		page(2),
	]);
});

test("only well-formed record pages are read back from storage", () => {
	assert.deepEqual(parseRecent(null), []);
	assert.deepEqual(parseRecent("{not json"), []);
	assert.deepEqual(parseRecent('{"href":"/models/x"}'), []);
	assert.deepEqual(
		parseRecent(
			JSON.stringify([
				{ href: "/keys/vk_1", title: "Prod", pinned: true },
				{ href: "/logs/op_1", title: "gpt-5 · op_1", pinned: "yes" },
				{ href: "https://example.com/models/x", title: "Elsewhere" },
				{ href: "//example.com/models", title: "Protocol-relative" },
				{ href: "/models/new", title: "New" },
				{ href: "/models", title: "A list" },
				{ href: "/keys/vk_2", title: "" },
				null,
			]),
		),
		[
			{ href: "/keys/vk_1", title: "Prod", pinned: true },
			{ href: "/logs/op_1", title: "gpt-5 · op_1", pinned: false },
		],
	);
});

test("record pages are a page nested under a list, never a creation form", () => {
	assert.equal(isRecordPath("/models/dep_1"), true);
	assert.equal(isRecordPath("/models/new"), false);
	assert.equal(isRecordPath("/models"), false);
	assert.equal(isRecordPath("/"), false);
});

test("a record's area is the sidebar page it hangs from", () => {
	assert.equal(areaOf("/models/dep_1"), "Models");
	assert.equal(areaOf("/keys/vk_1"), "API keys");
	assert.equal(areaOf("/logs/op_1"), "Logs");
	assert.equal(areaOf("/nowhere/x"), undefined);
});
