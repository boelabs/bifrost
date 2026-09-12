import { defineExtension } from "#extensions/sdk.ts";

/*
 * Provenance watermark — invisible, copy-paste-survivable signature in text replies.
 * ---------------------------------------------------------------------------
 * Embeds a short payload (e.g. an instance tag) into assistant text using zero-width characters. The
 * text looks identical to a human but carries a hidden marker, so leaked or pasted AI output can be
 * traced back to the gateway/tenant that produced it.
 *
 * Encoding: each payload bit becomes ZWSP (U+200B = 0) or ZWNJ (U+200C = 1), prefixed by a WORD
 * JOINER (U+2060) sentinel so a decoder can find it. The DECODER is documented in the README.
 *
 * Hooks used:
 *   - onCanonicalResponse  watermark non-streaming replies
 *   - onStreamEvent        watermark streaming replies exactly once (on the first content delta)
 *
 * Why this is interesting: steganographic provenance is a real need for AI platforms, and the
 * streaming case shows "do this once per request" state without buffering the whole stream.
 *
 * Caveat: zero-width characters survive copy-paste and most editors but are trivially stripped by a
 * motivated adversary. This is provenance/leak-tracing, not DRM, and not cryptographically signed.
 */

const ZERO = String.fromCharCode(0x200b); // ZERO WIDTH SPACE      -> bit 0
const ONE = String.fromCharCode(0x200c); //  ZERO WIDTH NON-JOINER -> bit 1
const MARK = String.fromCharCode(0x2060); // WORD JOINER           -> watermark sentinel

// requestId -> true once we've watermarked this stream.
const marked = new Set();

const configSchema = {
	safeParse(value) {
		const config =
			value && typeof value === "object" && !Array.isArray(value) ? value : {};
		const tag = config.tag ?? "Bifrost";
		if (typeof tag !== "string" || tag.length === 0 || tag.length > 64) {
			return {
				success: false,
				error: new Error(
					"config.tag must be a non-empty string up to 64 chars",
				),
			};
		}
		const position = config.position ?? "start";
		if (position !== "start" && position !== "afterFirstWord") {
			return {
				success: false,
				error: new Error('config.position must be "start" or "afterFirstWord"'),
			};
		}
		return { success: true, data: { tag, position } };
	},
};

function encode(tag) {
	const bytes = Buffer.from(tag, "utf8");
	let bits = MARK;
	for (const byte of bytes)
		for (let i = 7; i >= 0; i -= 1) bits += (byte >> i) & 1 ? ONE : ZERO;
	return bits;
}

function insert(text, watermark, position) {
	if (position === "afterFirstWord") {
		const space = text.search(/\s/);
		if (space > 0) return text.slice(0, space) + watermark + text.slice(space);
	}
	return watermark + text;
}

export default defineExtension({
	key: "provenancewatermark",
	version: "1.0.0",
	label: "Provenance watermark",
	description:
		"Embeds an invisible zero-width provenance marker into assistant text.",
	defaultCritical: false,
	configSchema,
	hooks: {
		onCanonicalResponse(ctx, response) {
			const watermark = encode(ctx.config.tag);
			return {
				...response,
				choices: response.choices.map((choice) => {
					const content = choice.message.content;
					if (typeof content !== "string" || content.length === 0)
						return choice;
					return {
						...choice,
						message: {
							...choice.message,
							content: insert(content, watermark, ctx.config.position),
						},
					};
				}),
			};
		},

		onStreamEvent(ctx, event) {
			// Watermark the FIRST non-empty content delta only, then leave the rest of the stream alone.
			let choices = event.choices;
			if (!marked.has(ctx.requestId)) {
				choices = event.choices.map((choice) => {
					const content = choice.delta.content;
					if (
						marked.has(ctx.requestId) ||
						typeof content !== "string" ||
						content.length === 0
					)
						return choice;
					marked.add(ctx.requestId);
					return {
						...choice,
						delta: {
							...choice.delta,
							content: insert(
								content,
								encode(ctx.config.tag),
								ctx.config.position,
							),
						},
					};
				});
			}
			// Release the per-request flag when the stream ends.
			if (event.choices.some((c) => c.finishReason !== null))
				marked.delete(ctx.requestId);
			return choices === event.choices ? event : { ...event, choices };
		},
	},
});
