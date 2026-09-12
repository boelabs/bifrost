import { getConnInfo } from "@hono/node-server/conninfo";
import type { AppEnv } from "#auth/types.ts";
import { env } from "#config/env.ts";
import type { Context } from "hono";
import { isIP } from "node:net";

function normalizeIp(value: string): string | null {
	let candidate = value.trim();
	const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
	if (bracketed?.[1]) candidate = bracketed[1];
	else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(candidate))
		candidate = candidate.slice(0, candidate.lastIndexOf(":"));
	return isIP(candidate) === 0 ? null : candidate;
}

export function resolveClientIp(
	remoteAddress: string | null,
	forwardedFor: string | undefined,
	trustedProxyHops: number,
): string | null {
	const remote = remoteAddress === null ? null : normalizeIp(remoteAddress);
	if (remote === null || trustedProxyHops <= 0 || forwardedFor === undefined)
		return remote;
	const forwarded: string[] = [];
	for (const part of forwardedFor.split(",")) {
		const address = normalizeIp(part);
		if (address === null) return remote;
		forwarded.push(address);
	}
	const chain = [...forwarded, remote];
	const index = chain.length - trustedProxyHops - 1;
	return index >= 0 ? (chain[index] ?? remote) : remote;
}

/** Resolves the client through an explicitly configured trusted proxy chain. */
export function clientIp(c: Context<AppEnv>): string | null {
	let remote: string | null = null;
	try {
		const info = getConnInfo(c);
		remote = info.remote.address ?? null;
	} catch {
		/* ignore */
	}
	return resolveClientIp(
		remote,
		c.req.header("x-forwarded-for"),
		env.TRUSTED_PROXY_HOPS,
	);
}
