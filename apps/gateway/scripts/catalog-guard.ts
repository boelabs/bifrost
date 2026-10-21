import type { GuardFinding } from "#catalog/sync/guard.ts";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
	guardChangedFiles,
	catalogDirectory,
	guardCatalog,
} from "#catalog/sync/guard.ts";

/**
 * Merge gate for automated catalog pull requests. Compares the working tree with its merge base on
 * --base (default origin/main). Exit 0: the catalog agent may merge. Exit 2: open the pull request but
 * leave the merge to a human. Exit 1: the change is not a valid catalog sync; fix it.
 */

function argValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(...args: string[]): string {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const base = argValue("--base") ?? "origin/main";
const root = git("rev-parse", "--show-toplevel");
const mergeBase = git("merge-base", base, "HEAD");
const changed = git("diff", "--name-only", mergeBase)
	.split("\n")
	.filter((path) => path.length > 0);

const findings: GuardFinding[] = guardChangedFiles(changed);
for (const path of changed) {
	const directory = catalogDirectory(path);
	if (directory === undefined) {
		continue;
	}
	let before: unknown = {};
	try {
		before = JSON.parse(git("show", `${mergeBase}:${path}`));
	} catch {
		findings.push({
			level: "block",
			message: `${path} is a new catalog; adding a provider is human work`,
		});
		continue;
	}
	const after: unknown = JSON.parse(readFileSync(`${root}/${path}`, "utf8"));
	findings.push(...guardCatalog(directory, before, after));
}

console.log(
	`catalog guard: ${changed.length} changed file(s) against ${base} (${mergeBase.slice(0, 7)})`,
);
for (const finding of findings) {
	console.log(`  [${finding.level}] ${finding.message}`);
}

if (findings.some((finding) => finding.level === "block")) {
	console.error(
		"catalog guard: blocked; fix the change before opening a pull request",
	);
	process.exit(1);
}
if (findings.length > 0) {
	console.error(
		"catalog guard: needs review; open the pull request, do not merge it",
	);
	process.exit(2);
}
console.log("catalog guard: ok to merge once CI is green");
