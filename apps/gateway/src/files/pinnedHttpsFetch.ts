import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

export interface ResolvedAddress {
	address: string;
	family: number;
}

export interface PinnedFetchOptions {
	method: "GET";
	headers: Record<string, string>;
	signal: AbortSignal;
}

function headersFromRaw(rawHeaders: string[]): Headers {
	const headers = new Headers();
	for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
		const name = rawHeaders[index];
		const value = rawHeaders[index + 1];
		if (name !== undefined && value !== undefined) headers.append(name, value);
	}
	return headers;
}

/**
 * Answers every DNS lookup for the connection with one already-validated address.
 *
 * The `all` flag decides the callback shape: `net` requests the array form whenever Happy Eyeballs
 * is enabled — always, under Bun — and answering such a lookup with the single-address triple
 * leaves the socket without an address, so the connection fails before it is opened.
 */
export function pinnedLookup(address: ResolvedAddress): LookupFunction {
	const family = address.family === 6 ? 6 : 4;
	return (_hostname, lookupOptions, callback) => {
		if (lookupOptions.all === true) {
			callback(null, [{ address: address.address, family }]);
			return;
		}
		callback(null, address.address, family);
	};
}

function requestAddress(
	url: URL,
	address: ResolvedAddress,
	options: PinnedFetchOptions,
): Promise<Response> {
	return new Promise((resolve, reject) => {
		const request = httpsRequest(
			url,
			{
				method: options.method,
				headers: { ...options.headers, "accept-encoding": "identity" },
				signal: options.signal,
				agent: false,
				lookup: pinnedLookup(address),
			},
			(incoming) => {
				const status = incoming.statusCode ?? 502;
				if (status < 200 || status > 599) {
					incoming.destroy();
					reject(new Error(`Unsupported upstream HTTP status ${status}`));
					return;
				}
				const bodyAllowed = ![101, 204, 205, 304].includes(status);
				if (!bodyAllowed) incoming.resume();
				const body = bodyAllowed
					? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>)
					: null;
				resolve(
					new Response(body, {
						status,
						...(incoming.statusMessage !== undefined
							? { statusText: incoming.statusMessage }
							: {}),
						headers: headersFromRaw(incoming.rawHeaders),
					}),
				);
			},
		);
		request.once("error", reject);
		request.end();
	});
}

/**
 * Performs HTTPS using only addresses that were already validated. TLS still authenticates the
 * original hostname through the URL/SNI, while the custom lookup closes the DNS-rebinding window.
 */
export async function fetchPinnedHttps(
	url: URL,
	addresses: readonly ResolvedAddress[],
	options: PinnedFetchOptions,
): Promise<Response> {
	let lastError: unknown;
	for (const address of addresses) {
		if (options.signal.aborted) throw options.signal.reason;
		try {
			return await requestAddress(url, address, options);
		} catch (error) {
			lastError = error;
		}
	}
	throw (
		lastError ??
		new Error(`No validated address is available for ${url.hostname}`)
	);
}
