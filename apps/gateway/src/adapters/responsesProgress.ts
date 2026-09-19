import { openaiResponsesStreamEventFromProviderFields } from "#core/providerSpecificFields.ts";
import { adapterDiagnostics, attachAdapterDiagnostics } from "./diagnostics.ts";
import type { CanonicalChatStreamChunk } from "#core/canonical.ts";

const toolItems = new Set([
	"function_call",
	"web_search_call",
	"file_search_call",
	"code_interpreter_call",
	"computer_call",
	"mcp_call",
	"image_generation_call",
	"local_shell_call",
	"shell_call",
	"apply_patch_call",
	"tool_search_call",
]);

/** Item lifecycle transitions are progress even when reasoning is encrypted or has no summary. */
export async function* observeResponsesProgress(
	chunks: AsyncIterable<CanonicalChatStreamChunk>,
): AsyncGenerator<CanonicalChatStreamChunk> {
	const seen = new Set<string>();
	for await (const chunk of chunks) {
		for (const choice of chunk.choices) {
			const event = openaiResponsesStreamEventFromProviderFields(
				choice.delta.providerFields,
			);
			if (
				!event ||
				(event.type !== "response.output_item.added" &&
					event.type !== "response.output_item.done")
			) {
				continue;
			}
			const { item } = event.data;
			if (!item || typeof item !== "object" || Array.isArray(item)) {
				continue;
			}
			const { id, type } = item as Record<string, unknown>;
			if (typeof id !== "string" || !id || typeof type !== "string") {
				continue;
			}
			const progress =
				type === "reasoning"
					? "reasoning"
					: toolItems.has(type)
						? "tool"
						: undefined;
			const key = `${event.type}:${id}`;
			if (!progress || seen.has(key)) {
				continue;
			}
			seen.add(key);
			attachAdapterDiagnostics(chunk, {
				...adapterDiagnostics(chunk),
				progress,
			});
		}
		yield chunk;
	}
}
