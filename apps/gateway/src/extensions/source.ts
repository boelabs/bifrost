import { listActiveArtifactsWithCode } from "#db/repos/extensions.ts";
import type { ExtensionInstanceSource } from "./runtime.ts";
import { listInstances } from "#db/repos/extensions.ts";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { existsSync, type Dirent } from "node:fs";
import { pathToFileURL } from "node:url";
import { log } from "#logging/log.ts";

import {
	writeFile,
	readdir,
	rename,
	unlink,
	mkdir,
	stat,
} from "node:fs/promises";

const EXTENSION_KEY_PATTERN = /^[a-z0-9]+$/;
const MATERIALIZED_MODULE_PATTERN = /^[a-z0-9]+-[a-f0-9]{64}\.mjs$/;
const STALE_TEMP_FILE_MS = 5 * 60_000;

/**
 * On-disk cache for materialized extension modules. It MUST live inside the gateway package so the
 * `#extensions/sdk.ts` subpath import that modules use resolves against this package's `imports` map.
 * Files are content-addressed (`<key>-<sha256>.mjs`), which both busts the ESM module cache when code
 * changes and lets a replica skip re-downloading a version it already has.
 */
export const EXTENSIONS_CACHE_DIR = resolve(
	import.meta.dirname,
	"..",
	"..",
	".extensions-cache",
);

export function sha256Hex(source: string): string {
	return createHash("sha256").update(source, "utf8").digest("hex");
}

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

/** Removes inactive materializations and abandoned atomic-write files from this replica. */
export async function pruneExtensionCache(
	activeModulePaths: ReadonlySet<string>,
	cacheDir = EXTENSIONS_CACHE_DIR,
): Promise<number> {
	let entries: Dirent[];
	try {
		entries = await readdir(cacheDir, { withFileTypes: true });
	} catch (error) {
		if (isMissingFile(error)) return 0;
		throw error;
	}
	let removed = 0;
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const path = join(cacheDir, entry.name);
		if (MATERIALIZED_MODULE_PATTERN.test(entry.name)) {
			if (activeModulePaths.has(path)) continue;
		} else if (entry.name.endsWith(".tmp")) {
			const info = await stat(path).catch(() => null);
			if (info === null || Date.now() - info.mtimeMs < STALE_TEMP_FILE_MS)
				continue;
		} else {
			continue;
		}
		try {
			await unlink(path);
			removed += 1;
		} catch (error) {
			if (!isMissingFile(error)) throw error;
		}
	}
	return removed;
}

function cacheFileFor(key: string, contentHash: string): string {
	return join(EXTENSIONS_CACHE_DIR, `${key}-${contentHash}.mjs`);
}

/**
 * Ensures the module source is present on disk at its content-addressed path, writing it atomically
 * (temp file + rename) if missing. Returns the absolute path to import.
 */
async function materialize(
	key: string,
	contentHash: string,
	code: string,
): Promise<string> {
	const file = cacheFileFor(key, contentHash);
	if (existsSync(file)) return file;
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(tmp, code, "utf8");
		try {
			await rename(tmp, file);
		} catch (error) {
			// Concurrent reloads may materialize the same content-addressed module. The winner's
			// identical file is authoritative; every other rename may safely converge on it.
			if (!existsSync(file)) throw error;
		}
	} finally {
		await unlink(tmp).catch((error: unknown) => {
			if (!isMissingFile(error)) throw error;
		});
	}
	return file;
}

interface ProbeResult {
	contentHash: string;
	sizeBytes: number;
}

/**
 * Validates uploaded module source before it is persisted: it stages the file (so the SDK subpath
 * import resolves), imports it, and asserts it exports a definition whose `key` matches. Importing
 * executes the module's top-level code — extensions are trusted, master-only code by design. Throws a
 * plain Error (the admin layer maps it to a 400) on any failure, so a bad upload never reaches the
 * database or the boot path.
 */
export async function probeArtifact(
	key: string,
	code: string,
): Promise<ProbeResult> {
	if (!EXTENSION_KEY_PATTERN.test(key))
		throw new Error(`Invalid extension key "${key}"`);
	const contentHash = sha256Hex(code);
	const file = await materialize(key, contentHash, code);

	let namespace: Record<string, unknown>;
	try {
		namespace = (await import(pathToFileURL(file).href)) as Record<
			string,
			unknown
		>;
	} catch (err) {
		throw new Error(
			`Module failed to import: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	const definition = namespace.default ?? namespace.extension;
	if (
		typeof definition !== "object" ||
		definition === null ||
		typeof (definition as { key?: unknown }).key !== "string" ||
		typeof (definition as { hooks?: unknown }).hooks !== "object" ||
		(definition as { hooks?: unknown }).hooks === null
	) {
		throw new Error("Module must export a valid extension definition");
	}
	if ((definition as { key: string }).key !== key) {
		throw new Error(
			`Module exports key "${(definition as { key: string }).key}" but was uploaded as "${key}"`,
		);
	}
	return { contentHash, sizeBytes: Buffer.byteLength(code, "utf8") };
}

/**
 * Loads the manifest from the database: active artifacts become materialized modules, instances become
 * manifest entries. Implements the source contract the runtime already consumes.
 */
export class DbExtensionInstanceSource implements ExtensionInstanceSource {
	async load() {
		const [artifacts, instances] = await Promise.all([
			listActiveArtifactsWithCode(),
			listInstances(),
		]);

		// A single bad artifact (integrity mismatch or a non-writable cache dir) is skipped, not fatal:
		// the runtime then disables any instance that referenced it instead of failing to load at all.
		const modules: Array<{ path: string }> = [];
		for (const artifact of artifacts) {
			try {
				const actual = sha256Hex(artifact.code);
				if (actual !== artifact.contentHash) {
					throw new Error(
						`artifact "${artifact.key}" v${artifact.version} failed integrity check`,
					);
				}
				const path = await materialize(
					artifact.key,
					artifact.contentHash,
					artifact.code,
				);
				modules.push({ path });
			} catch (err) {
				log.error(
					"extensions",
					"skipped extension artifact that failed to load",
					{
						extensionKey: artifact.key,
						version: artifact.version,
						err,
					},
				);
			}
		}

		return {
			modules,
			instances: instances.map((row) => ({
				id: row.id,
				definition: row.definitionKey,
				enabled: row.enabled,
				priority: row.priority,
				...(row.critical !== null ? { critical: row.critical } : {}),
				match: row.match,
				config: row.config,
			})),
		};
	}
}
