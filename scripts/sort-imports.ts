/**
 * @fileoverview Sorts imports by length (descending) across the whole repo.
 *
 * Summary:
 * - Reorders each import zone in a source file into three shape-based spans: single-line imports,
 *   multiline imports and, if present, side-effect-only (bare) imports.
 * - Within each span, sorts by apparent length (longest first) in a stable way.
 * - Also sorts named members of a multiline import by length.
 *
 * Formatting compatibility (biome):
 * - Only MOVES already-formatted lines; it never rewrites quotes, commas, `;`, or indentation, so
 *   the result remains valid for `biome format` (idempotent). Keep `organizeImports` disabled in
 *   biome.json so it does not compete by sorting alphabetically.
 * - Side-effect-only imports (`import "#adapters/index.ts"`) are NOT reordered with other imports:
 *   their execution order is semantic, so they act as a barrier that splits the zone.
 *
 * Usage:
 *   bun run format                          # Biome format + this import sort across the monorepo
 *   bun scripts/sort-imports.ts             # sorts the whole monorepo (apps, packages, scripts)
 *   bun scripts/sort-imports.ts <path...>   # sorts only the given files or folders
 *
 * @author Boelabs
 * @since 1.0.0
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

type ImportDeclaration = {
	bare: boolean;
	codeLines: string[];
	index: number;
	multiline: boolean;
	text: string;
	weight: number;
};

const SOURCE_EXTENSIONS = new Set([
	".cjs",
	".cts",
	".js",
	".jsx",
	".mjs",
	".mts",
	".ts",
	".tsx",
]);

const IGNORED_DIRECTORIES = new Set([
	".git",
	".next",
	".github",
	".source",
	".turbo",
	".vscode",
	"build",
	"coverage",
	"dist",
	"node_modules",
]);

// Default roots (relative to the repo root) sorted when no explicit path is given. node_modules and
// generated dirs are skipped via IGNORED_DIRECTORIES.
const REPO_ROOTS = ["apps", "packages", "scripts"];

const args = process.argv.slice(2);
const explicitTargets = args.filter((arg) => !arg.startsWith("--"));

const files = explicitTargets.length
	? await collectTargetFiles(explicitTargets)
	: await collectWorkspaceFiles(REPO_ROOTS);
const changed = await sortFiles(files);

console.log(
	changed === 1
		? "Sorted imports in 1 file."
		: `Sorted imports in ${changed} files.`,
);

async function sortFiles(files: string[]): Promise<number> {
	let changed = 0;

	for (const file of files) {
		if (await sortFile(file)) {
			changed += 1;
		}
	}

	return changed;
}

async function sortFile(file: string): Promise<boolean> {
	if (!isSourceFile(file) || !existsSync(file)) {
		return false;
	}

	const original = await readFile(file, "utf8");
	const sorted = sortToFixedPoint(original);

	if (sorted === original) {
		return false;
	}

	await writeFile(file, sorted, "utf8");
	return true;
}

/**
 * Applies sorting until reaching a fixed point. Reordering can change the apparent length
 * of a zone and enable another adjustment in the next pass; iterating guarantees stable output
 * (idempotent). Bounded so a pathological input cannot hang.
 */
function sortToFixedPoint(original: string): string {
	let current = original;

	for (let pass = 0; pass < 8; pass += 1) {
		const next = sortImportsInText(current);

		if (next === current) {
			break;
		}

		current = next;
	}

	return current;
}

function sortImportsInText(original: string): string {
	if (!original.includes("import")) {
		return original;
	}

	const eol = original.includes("\r\n") ? "\r\n" : "\n";
	const hasFinalEol = original.endsWith("\n");
	const bom = original.startsWith("﻿") ? "﻿" : "";
	const text = bom ? original.slice(1) : original;
	const lines = text.split(/\r?\n/);

	if (hasFinalEol) {
		lines.pop();
	}

	const firstImportLine = findFirstImportLine(lines);

	if (firstImportLine === -1) {
		return original;
	}

	const { imports, nextLine } = readImportZone(lines, firstImportLine);

	if (imports.length < 2) {
		return original;
	}

	const sortedZone = renderImportZone(imports, eol);
	const prefixLines = trimTrailingEmpty(lines.slice(0, firstImportLine));
	const suffixLines = trimLeadingEmpty(lines.slice(nextLine));
	const parts = [
		prefixLines.join(eol),
		sortedZone,
		suffixLines.join(eol),
	].filter(Boolean);
	let result = `${bom}${parts.join(`${eol}${eol}`)}`;

	if (hasFinalEol) {
		result += eol;
	}

	return result;
}

function findFirstImportLine(lines: string[]): number {
	let inBlockComment = false;

	for (let index = 0; index < lines.length; index += 1) {
		const trimmed = (lines[index] ?? "").trim();

		if (index === 0 && trimmed.startsWith("#!")) {
			continue;
		}

		if (inBlockComment) {
			if (trimmed.includes("*/")) {
				inBlockComment = false;
			}
			continue;
		}

		if (!trimmed || isDirective(trimmed) || trimmed.startsWith("//")) {
			continue;
		}

		if (trimmed.startsWith("/*")) {
			inBlockComment = !trimmed.includes("*/");
			continue;
		}

		return isStaticImportStart(trimmed) ? index : -1;
	}

	return -1;
}

function readImportZone(
	lines: string[],
	startLine: number,
): { imports: ImportDeclaration[]; nextLine: number } {
	const imports: ImportDeclaration[] = [];
	let index = startLine;

	while (index < lines.length) {
		while (isBlank(lines[index])) {
			index += 1;
		}

		const leadingComments = readAttachedComments(lines, index);
		const importStart = leadingComments.nextLine;

		if (!isStaticImportStart((lines[importStart] ?? "").trim())) {
			break;
		}

		const declaration = readImportDeclaration(lines, importStart);
		const codeLines = sortNamedImportMembers(declaration.lines);
		const fullLines = [...leadingComments.lines, ...codeLines];
		const text = fullLines.join("\n");

		imports.push({
			bare: isBareImport(codeLines),
			codeLines,
			index: imports.length,
			multiline: codeLines.length > 1,
			text,
			weight: measureImportWeight(codeLines),
		});

		index = declaration.nextLine;
	}

	return { imports, nextLine: index };
}

function readAttachedComments(
	lines: string[],
	startLine: number,
): { lines: string[]; nextLine: number } {
	const comments: string[] = [];
	let index = startLine;

	while (index < lines.length) {
		const line = lines[index] ?? "";
		const trimmed = line.trim();

		if (trimmed.startsWith("//")) {
			comments.push(line);
			index += 1;
			continue;
		}

		if (trimmed.startsWith("/*")) {
			do {
				comments.push(lines[index] ?? "");
				index += 1;
			} while (
				index < lines.length &&
				!(lines[index - 1] ?? "").includes("*/")
			);
			continue;
		}

		break;
	}

	return { lines: comments, nextLine: index };
}

function readImportDeclaration(
	lines: string[],
	startLine: number,
): { lines: string[]; nextLine: number } {
	const declarationLines: string[] = [];
	let depth = 0;
	let index = startLine;

	while (index < lines.length) {
		const line = lines[index] ?? "";
		declarationLines.push(line);

		for (const character of line) {
			if (character === "{" || character === "[" || character === "(") {
				depth += 1;
			} else if (character === "}" || character === "]" || character === ")") {
				depth -= 1;
			}
		}

		index += 1;

		if (line.includes(";") && depth <= 0) {
			break;
		}
	}

	return { lines: declarationLines, nextLine: index };
}

function sortNamedImportMembers(lines: string[]): string[] {
	if (lines.length < 3) {
		return lines;
	}

	const openIndex = lines.findIndex((line) => line.includes("{"));
	const closeIndex = lines.findIndex(
		(line, index) => index > openIndex && line.includes("}"),
	);

	if (openIndex === -1 || closeIndex <= openIndex + 1) {
		return lines;
	}

	const innerLines = lines.slice(openIndex + 1, closeIndex);

	if (innerLines.some((line) => line.trim().startsWith("//"))) {
		return lines;
	}

	const sortedInnerLines = stableSortByWeight(innerLines, (line) =>
		visibleSpecifierLength(line),
	);

	return [
		...lines.slice(0, openIndex + 1),
		...sortedInnerLines,
		...lines.slice(closeIndex),
	];
}

function renderImportZone(imports: ImportDeclaration[], eol: string): string {
	// Side-effect-only (bare) imports act as a barrier: they are never reordered with other imports
	// because their execution order is semantic. Each span of regular imports is sorted separately.
	const blocks: string[] = [];
	let run: ImportDeclaration[] = [];

	const flushRun = (): void => {
		if (run.length > 0) {
			blocks.push(renderSortableRun(run, eol));
			run = [];
		}
	};

	for (const declaration of imports) {
		if (declaration.bare) {
			flushRun();
			blocks.push(declaration.text);
		} else {
			run.push(declaration);
		}
	}
	flushRun();

	return blocks.filter(Boolean).join(`${eol}${eol}`);
}

function renderSortableRun(imports: ImportDeclaration[], eol: string): string {
	const singleImports = imports.filter((declaration) => !declaration.multiline);
	const multilineImports = imports.filter(
		(declaration) => declaration.multiline,
	);
	const blocks = [
		renderImportBlock(sortDeclarations(singleImports), eol),
		renderImportBlock(sortDeclarations(multilineImports), `${eol}${eol}`),
	].filter(Boolean);

	return blocks.join(`${eol}${eol}`);
}

function renderImportBlock(
	imports: ImportDeclaration[],
	separator: string,
): string {
	return imports.map((declaration) => declaration.text).join(separator);
}

function sortDeclarations(imports: ImportDeclaration[]): ImportDeclaration[] {
	return stableSortByWeight(imports, (declaration) => declaration.weight);
}

function stableSortByWeight<T>(
	items: T[],
	getWeight: (item: T) => number,
): T[] {
	return items
		.map((item, index) => ({ index, item, weight: getWeight(item) }))
		.sort(
			(left, right) => right.weight - left.weight || left.index - right.index,
		)
		.map(({ item }) => item);
}

function measureImportWeight(lines: string[]): number {
	return lines
		.map((line) => line.trim())
		.join(" ")
		.replace(/\s+/g, " ").length;
}

function visibleSpecifierLength(line: string): number {
	return line.trim().replace(/,$/, "").length;
}

function isBareImport(lines: string[]): boolean {
	const firstLine = (lines[0] ?? "").trim();

	return /^import\s+['"]/.test(firstLine);
}

function isStaticImportStart(trimmedLine: string): boolean {
	return /^import(?:\s|['"])/.test(trimmedLine);
}

function isDirective(trimmedLine: string): boolean {
	return /^(['"])[^'"]+\1;?$/.test(trimmedLine);
}

function isBlank(line: string | undefined): boolean {
	return line !== undefined && line.trim() === "";
}

function trimLeadingEmpty(lines: string[]): string[] {
	let start = 0;

	while (start < lines.length && (lines[start] ?? "").trim() === "") {
		start += 1;
	}

	return lines.slice(start);
}

function trimTrailingEmpty(lines: string[]): string[] {
	let end = lines.length;

	while (end > 0 && (lines[end - 1] ?? "").trim() === "") {
		end -= 1;
	}

	return lines.slice(0, end);
}

async function collectTargetFiles(targets: string[]): Promise<string[]> {
	const files = new Set<string>();

	for (const target of targets) {
		const absoluteTarget = path.resolve(target);

		if (!existsSync(absoluteTarget)) {
			continue;
		}

		if (statSync(absoluteTarget).isDirectory()) {
			for (const file of await collectWorkspaceFiles([absoluteTarget])) {
				files.add(file);
			}
			continue;
		}

		if (isSourceFile(absoluteTarget)) {
			files.add(absoluteTarget);
		}
	}

	return [...files].sort();
}

async function collectWorkspaceFiles(roots: string[]): Promise<string[]> {
	const files: string[] = [];

	for (const root of roots) {
		const absoluteRoot = path.resolve(root);

		if (existsSync(absoluteRoot)) {
			await collectFilesFromDirectory(absoluteRoot, files);
		}
	}

	return files.sort();
}

async function collectFilesFromDirectory(
	directory: string,
	files: string[],
): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true });

	for (const entry of entries) {
		const absolutePath = path.join(directory, entry.name);

		if (entry.isDirectory()) {
			if (IGNORED_DIRECTORIES.has(entry.name)) {
				continue;
			}

			await collectFilesFromDirectory(absolutePath, files);
			continue;
		}

		if (entry.isFile() && isSourceFile(absolutePath)) {
			files.push(absolutePath);
		}
	}
}

function isSourceFile(file: string): boolean {
	return SOURCE_EXTENSIONS.has(path.extname(file));
}
