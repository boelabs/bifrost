import { rankingFrom, rerankBody, runRerank } from "./rerank";
import { documentsFrom } from "./RerankWorkspace";
import assert from "node:assert/strict";
import type { FetchLike } from "./api";
import { test } from "node:test";

const documents = ["first", "second", "third"];

test("top_n is sent only when it was chosen", () => {
	assert.deepEqual(rerankBody("m", "q", documents, {}), {
		model: "m",
		query: "q",
		documents,
	});
	assert.deepEqual(rerankBody("m", "q", documents, { topN: 2 }), {
		model: "m",
		query: "q",
		documents,
		top_n: 2,
	});
});

test("a ranking keeps each document's original position and reads its text from the request", () => {
	assert.deepEqual(
		rankingFrom(
			{
				results: [
					{ index: 2, relevance_score: 0.9 },
					{ index: 0, relevance_score: 0.1 },
				],
			},
			documents,
		),
		[
			{ index: 2, score: 0.9, text: "third" },
			{ index: 0, score: 0.1, text: "first" },
		],
	);
});

test("a provider that names the score differently, or echoes the document, still ranks", () => {
	assert.deepEqual(
		rankingFrom(
			{
				results: [
					{ index: 0, score: 0.5 },
					{ index: 9, document: { text: "echoed" } },
					{ index: 8, document: "plain" },
				],
			},
			documents,
		),
		[
			{ index: 0, score: 0.5, text: "first" },
			{ index: 9, score: 0, text: "echoed" },
			{ index: 8, score: 0, text: "plain" },
		],
	);
});

test("a result pointing at a document nobody sent is dropped rather than rendered empty", () => {
	assert.deepEqual(rankingFrom({ results: [{ index: 7 }] }, documents), []);
});

test("a document is a line, and blank lines are not documents", () => {
	assert.deepEqual(documentsFrom(" a \n\n b \n   "), ["a", "b"]);
	assert.deepEqual(documentsFrom("\n \n"), []);
});

test("the request goes to the relay and failures keep the gateway's message", async () => {
	let url: string | undefined;
	const ok: FetchLike = async (input) => {
		url = String(input);
		return Response.json({ results: [] });
	};
	await runRerank(
		{ model: "m", query: "q", documents, settings: {} },
		{ fetch: ok, csrf: () => undefined },
	);
	assert.equal(url, "/api/v1/rerank");

	const failing: FetchLike = async () =>
		new Response(
			JSON.stringify({ error: { message: "no rerank deployment" } }),
			{
				status: 503,
				headers: { "content-type": "application/json" },
			},
		);
	await assert.rejects(
		runRerank(
			{ model: "m", query: "q", documents, settings: {} },
			{ fetch: failing, csrf: () => undefined },
		),
		/no rerank deployment/,
	);
});
