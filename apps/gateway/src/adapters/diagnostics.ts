import type { AdapterContext, AdapterDiagnostics } from "./types.ts";

const diagnostics = new WeakMap<object, AdapterDiagnostics>();

export function attachAdapterDiagnostics<T extends object>(
	value: T,
	evidence: AdapterDiagnostics,
): T {
	diagnostics.set(value, evidence);
	return value;
}

export function adapterDiagnostics(
	value: object,
): AdapterDiagnostics | undefined {
	return diagnostics.get(value);
}

export function recordUnknownAdapterEvent(
	evidence: AdapterDiagnostics,
	type: string,
): void {
	if (evidence.metadata === undefined) evidence.metadata = {};
	const metadata = evidence.metadata;
	const counts =
		(metadata.unknownEventCounts as Record<string, number> | undefined) ?? {};
	counts[type] = (counts[type] ?? 0) + 1;
	metadata.unknownEventCounts = counts;
}

export function adapterContextDiagnostics(
	ctx: AdapterContext,
): AdapterDiagnostics {
	if (ctx.diagnostics === undefined) ctx.diagnostics = {};
	return ctx.diagnostics;
}
