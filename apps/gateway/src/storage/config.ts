import { env } from "#config/env.ts";

/**
 * Object storage, as one connection string — the shape `DATABASE_URL` and `REDIS_URL` already use.
 *
 *   unset                                        storage disabled
 *   file:.source/object-storage                  on disk, at that path
 *   s3://key:secret@host/bucket?region=auto      S3 or anything that speaks it
 *
 * Deriving the backend from the URL removes a whole class of mistake: filling in the credentials
 * and forgetting the flag that turns them on.
 */
export type ObjectStorageConfig =
	| { backend: "disabled" }
	| { backend: "local"; root: string }
	| {
			backend: "s3";
			bucket: string;
			region: string;
			endpoint?: string;
			accessKeyId: string;
			secretAccessKey: string;
			forcePathStyle: boolean;
	  };

function invalid(reason: string): never {
	throw new Error(
		`OBJECT_STORAGE_URL is invalid: ${reason}\n` +
			"\n" +
			"  file:.source/object-storage                       store on disk\n" +
			"  s3://key:secret@host/bucket?region=auto           store in S3\n" +
			"\n" +
			"Leave it unset to run without object storage.",
	);
}

export function parseObjectStorage(
	raw: string | undefined,
): ObjectStorageConfig {
	const value = raw?.trim();
	if (!value) return { backend: "disabled" };

	// Parsed by hand rather than through `URL`, which rewrites a relative path into an absolute one.
	if (value.startsWith("file:")) {
		const root = value.slice("file:".length).replace(/^\/\//, "");
		if (!root) invalid("file: needs a path");
		return { backend: "local", root };
	}

	if (!value.startsWith("s3://")) invalid(`unknown scheme in "${value}"`);
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return invalid(`could not parse "${value}"`);
	}
	const bucket = decodeURIComponent(url.pathname.replace(/^\//, ""));
	if (!bucket) invalid("no bucket in the path");
	if (!url.username || !url.password) invalid("no credentials before the host");

	return {
		backend: "s3",
		bucket,
		region: url.searchParams.get("region") ?? "auto",
		// A bare `s3://` host means AWS itself, which the SDK addresses from the region alone.
		...(url.host && url.host !== "s3.amazonaws.com"
			? {
					endpoint: `${url.searchParams.get("tls") === "false" ? "http" : "https"}://${url.host}`,
				}
			: {}),
		accessKeyId: decodeURIComponent(url.username),
		secretAccessKey: decodeURIComponent(url.password),
		forcePathStyle: url.searchParams.get("pathStyle") === "true",
	};
}

export const objectStorage = parseObjectStorage(env.OBJECT_STORAGE_URL);
