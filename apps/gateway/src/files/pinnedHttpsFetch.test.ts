import { fetchPinnedHttps, pinnedLookup } from "./pinnedHttpsFetch.ts";
import type { PinnedFetchOptions } from "./pinnedHttpsFetch.ts";
import { createServer, type Socket } from "node:net";
import type { LookupAddress } from "node:dns";
import assert from "node:assert/strict";
import { test } from "node:test";

type LookupCallbackArguments = [
	NodeJS.ErrnoException | null,
	string | LookupAddress[],
	number | undefined,
];

interface TcpSink {
	port: number;
	peer: Promise<string>;
	close: () => Promise<void>;
}

/**
 * Accepts connections on 127.0.0.1 and holds them open: the socket-level tests end by aborting the
 * request, so no test depends on how a runtime reports a connection the peer tore down.
 */
async function startTcpSink(): Promise<TcpSink> {
	const first = Promise.withResolvers<string>();
	const held: Socket[] = [];
	const server = createServer((socket) => {
		held.push(socket);
		first.resolve(socket.remoteAddress ?? "");
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	assert.ok(address !== null && typeof address === "object");
	return {
		port: address.port,
		peer: first.promise,
		close: async () => {
			for (const socket of held) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

/** Keeps a missed connection a fast, legible failure instead of a suite-wide hang. */
async function connectedPeer(sink: TcpSink): Promise<string> {
	const timeout = Promise.withResolvers<never>();
	const timer = setTimeout(
		() => timeout.reject(new Error("no connection reached the pinned address")),
		2000,
	);
	try {
		return await Promise.race([sink.peer, timeout.promise]);
	} finally {
		clearTimeout(timer);
	}
}

function fetchOptions(signal: AbortSignal): PinnedFetchOptions {
	return { method: "GET", headers: { accept: "*/*" }, signal };
}

function callbackArguments(
	address: { address: string; family: number },
	all: boolean,
): LookupCallbackArguments {
	let observed: LookupCallbackArguments | undefined;
	pinnedLookup(address)(
		"example.com",
		{ all, hints: 0 },
		(error, resolved, family) => {
			observed = [error, resolved, family];
		},
	);
	assert.ok(observed !== undefined);
	return observed;
}

test("pinned lookup answers an all:true lookup with the address array", () => {
	assert.deepEqual(
		callbackArguments({ address: "203.0.113.7", family: 4 }, true),
		[null, [{ address: "203.0.113.7", family: 4 }], undefined],
	);
});

test("pinned lookup answers a single-address lookup with the address triple", () => {
	assert.deepEqual(
		callbackArguments({ address: "2001:db8::1", family: 6 }, false),
		[null, "2001:db8::1", 6],
	);
});

test("pinned lookup normalizes an unknown address family to IPv4", () => {
	assert.deepEqual(
		callbackArguments({ address: "203.0.113.7", family: 0 }, true),
		[null, [{ address: "203.0.113.7", family: 4 }], undefined],
	);
});

test("pinned fetch connects to the pinned address instead of resolving the host", async () => {
	const sink = await startTcpSink();
	const controller = new AbortController();
	try {
		// `pinned.invalid` never resolves: reaching the sink proves the pin was honored.
		const pending = fetchPinnedHttps(
			new URL(`https://pinned.invalid:${sink.port}/file.pdf`),
			[{ address: "127.0.0.1", family: 4 }],
			fetchOptions(controller.signal),
		);
		const peer = await connectedPeer(sink);
		controller.abort(new Error("connection observed"));
		await assert.rejects(pending);
		assert.equal(peer, "127.0.0.1");
	} finally {
		await sink.close();
	}
});

test("pinned fetch rejects when no validated address is available", async () => {
	await assert.rejects(
		fetchPinnedHttps(
			new URL("https://pinned.invalid/"),
			[],
			fetchOptions(new AbortController().signal),
		),
		/No validated address is available for pinned\.invalid/,
	);
});

test("pinned fetch rejects with the abort reason before connecting", async () => {
	const controller = new AbortController();
	const reason = new Error("aborted before connect");
	controller.abort(reason);
	await assert.rejects(
		fetchPinnedHttps(
			new URL("https://pinned.invalid/"),
			[{ address: "127.0.0.1", family: 4 }],
			fetchOptions(controller.signal),
		),
		(error: unknown) => error === reason,
	);
});
