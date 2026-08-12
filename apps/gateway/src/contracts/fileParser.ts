import { GatewayError } from "#core/errors.ts";

import type {
	CanonicalFileParserOptions,
	PdfParserEngine,
} from "#core/canonical.ts";

interface PluginConfig extends Record<string, unknown> {
	id?: unknown;
	enabled?: unknown;
	pdf?: unknown;
}

const PDF_ENGINES = new Set<PdfParserEngine>(["auto", "native", "pdf-text"]);

/** Normalizes the OpenRouter-compatible file-parser request extension. */
export function fileParserOptionsFromPlugins(
	plugins: PluginConfig[] | undefined,
): CanonicalFileParserOptions | undefined {
	if (plugins === undefined) return undefined;
	let resolved: CanonicalFileParserOptions | undefined;

	for (const plugin of plugins) {
		if (plugin.enabled !== undefined && typeof plugin.enabled !== "boolean") {
			throw new GatewayError({
				class: "bad_request",
				code: "invalid_plugin_config",
				param: "plugins",
				message: "file-parser.enabled must be a boolean",
				publicMessage: "Plugin enabled must be a boolean.",
			});
		}
		if (plugin.enabled === false) continue;
		if (plugin.id !== "file-parser") {
			throw new GatewayError({
				class: "bad_request",
				code: "unsupported_plugin",
				param: "plugins",
				message: `Unsupported plugin: ${String(plugin.id ?? "")}`,
				publicMessage: "Only the file-parser plugin is supported.",
			});
		}
		if (resolved !== undefined) {
			throw new GatewayError({
				class: "bad_request",
				code: "duplicate_plugin",
				param: "plugins",
				message: "The file-parser plugin may only be configured once",
				publicMessage: "The file-parser plugin may only be configured once.",
			});
		}

		const pdf = plugin.pdf;
		if (
			pdf !== undefined &&
			(pdf === null || typeof pdf !== "object" || Array.isArray(pdf))
		) {
			throw new GatewayError({
				class: "bad_request",
				code: "invalid_plugin_config",
				param: "plugins",
				message: "file-parser.pdf must be an object",
				publicMessage: "file-parser.pdf must be an object.",
			});
		}
		const rawEngine = (pdf as { engine?: unknown } | undefined)?.engine;
		const engine = rawEngine ?? "auto";
		if (
			typeof engine !== "string" ||
			!PDF_ENGINES.has(engine as PdfParserEngine)
		) {
			throw new GatewayError({
				class: "bad_request",
				code: "unsupported_file_parser_engine",
				param: "plugins",
				message: `Unsupported file-parser PDF engine: ${String(engine)}`,
				publicMessage:
					'file-parser PDF engine must be "auto", "native", or "pdf-text".',
			});
		}
		resolved = { pdfEngine: engine as PdfParserEngine };
	}

	return resolved;
}
