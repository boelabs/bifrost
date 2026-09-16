import { parsePublicModels, type PlaygroundModel } from "./models.ts";
import { publicApi } from "#/shared/api/client.ts";
import { unwrap } from "#/shared/api/errors.ts";
import { cacheLife } from "next/cache";

/**
 * The gateway's public model catalog, as the request that fetches it.
 *
 * Separate from the cached wrapper below so it can be tested without a Next cache scope: what the
 * tests care about is that a 503 propagates the gateway's message and that an empty list is not
 * mistaken for a failure, neither of which involves caching.
 *
 * The plain `unwrap`, not the session client's: this call carries no session, so it has none to
 * lose, and the redirect that one raises on a 401 is not allowed inside a `'use cache'` scope.
 */
export async function fetchPublicModels(): Promise<PlaygroundModel[]> {
	return parsePublicModels(unwrap(await publicApi.GET("/v1/models")));
}

/**
 * The same catalog, cached.
 *
 * `GET /v1/models` is deliberately unauthenticated, like other providers' public catalogs, and
 * answers the same for everyone — which makes it the one thing in this dashboard worth caching at
 * all. It goes through `publicApi` rather than the session client for exactly that reason: a
 * `'use cache'` scope may not read cookies, and the session middleware does.
 *
 * The lifetime is short on purpose. A cache whose `expire` is under five minutes counts as
 * short-lived and is left out of prerendering, so `next build` never has to reach a running gateway
 * — while a couple of minutes is still long enough to spare every visit to the playground its own
 * round trip.
 */
export async function listPublicModels(): Promise<PlaygroundModel[]> {
	"use cache";
	cacheLife({ stale: 60, revalidate: 120, expire: 240 });
	return fetchPublicModels();
}
