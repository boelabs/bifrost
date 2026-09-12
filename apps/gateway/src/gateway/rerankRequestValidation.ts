import type { ResolvedModelMetadata } from "#catalog/types.ts";
import type { CanonicalRerankRequest } from "#core/rerank.ts";
import { rerankProfileFor } from "#catalog/types.ts";
import type { Adapter } from "#adapters/types.ts";
import { GatewayError } from "#core/errors.ts";

const encoder = new TextEncoder();

function unsupported(param: string, message: string): never {
	throw new GatewayError({
		class: "bad_request",
		code: "unsupported_parameter",
		message,
		publicMessage: message,
		param,
	});
}

function bytes(value: string): number {
	return encoder.encode(value).length;
}

export function assertRerankProviderSupported(
	request: CanonicalRerankRequest,
	adapter: Adapter,
): void {
	if (request.provider === undefined) return;
	if (adapter.rerank?.supportsProviderRouting) return;
	unsupported(
		"provider",
		'The "provider" field requires an OpenRouter-backed deployment.',
	);
}

export function assertRerankRequestSupported(
	request: CanonicalRerankRequest,
	meta: ResolvedModelMetadata,
): void {
	const profile = rerankProfileFor(meta);
	if (!profile)
		unsupported("model", "The selected model has no rerank profile.");
	if (!profile.documentModalities.includes("text"))
		unsupported(
			"documents",
			"The selected model does not accept text documents.",
		);
	if (
		profile.maxDocuments !== undefined &&
		request.documents.length > profile.maxDocuments
	)
		unsupported(
			"documents",
			`The selected model accepts at most ${profile.maxDocuments} documents.`,
		);
	if (
		profile.maxQueryBytes !== undefined &&
		bytes(request.query) > profile.maxQueryBytes
	)
		unsupported(
			"query",
			`The query exceeds the ${profile.maxQueryBytes} byte model limit.`,
		);

	let totalBytes = 0;
	for (const [index, document] of request.documents.entries()) {
		if (document.type !== "text")
			unsupported(
				`documents.${index}`,
				"Image documents are not enabled in the current rerank contract.",
			);
		const documentBytes = bytes(document.text);
		totalBytes += documentBytes;
		if (
			profile.maxDocumentBytes !== undefined &&
			documentBytes > profile.maxDocumentBytes
		)
			unsupported(
				`documents.${index}`,
				`One document exceeds the ${profile.maxDocumentBytes} byte model limit.`,
			);
	}
	if (
		profile.maxTotalDocumentBytes !== undefined &&
		totalBytes > profile.maxTotalDocumentBytes
	)
		unsupported(
			"documents",
			`Documents exceed the ${profile.maxTotalDocumentBytes} byte aggregate model limit.`,
		);
}
