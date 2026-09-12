import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

async function sourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return sourceFiles(path);
			return entry.isFile() &&
				path.endsWith(".ts") &&
				!path.endsWith(".test.ts")
				? [path]
				: [];
		}),
	);
	return nested.flat();
}

const violations: string[] = [];
for (const file of await sourceFiles(
	fileURLToPath(new URL("../src/adapters", import.meta.url)),
)) {
	const source = await readFile(file, "utf8");
	if (/\bfetch\s*\(/.test(source)) violations.push(`${file}: direct fetch()`);
	if (/new\s+WebSocket\s*\(/.test(source))
		violations.push(`${file}: direct WebSocket construction`);
}

if (violations.length > 0) {
	console.error(
		`Adapters must use #gateway/instrumentedTransport.ts:\n${violations.join("\n")}`,
	);
	process.exit(1);
}
