import { defineExtension } from "#extensions/sdk.ts";

/*
 * PII vault — tokenize on the way in, restore on the way out.
 * ---------------------------------------------------------------------------
 * Replaces personally identifiable information in the user's prompt with opaque tokens BEFORE the
 * request leaves the gateway, so the upstream provider never sees the raw values. On the way back it
 * restores the real values in the model's reply, so the client experience is unchanged.
 *
 *   client: "email me at jane.doe@acme.com"      →  upstream sees: "email me at «V1»"
 *   upstream: "I'll write to «V1» shortly"         →  client sees:  "I'll write to jane.doe@acme.com"
 *
 * Hooks used (all four non-image hooks, working together):
 *   - onCanonicalRequest   mask PII, remember the mapping for this request
 *   - onCanonicalResponse  restore PII in non-streaming replies
 *   - onStreamEvent        restore PII in streaming replies, across chunk boundaries (the hard part)
 *   - onError              drop the per-request mapping if the call fails mid-flight (no leaks)
 *
 * Why this is interesting:
 *   1. Two cooperating hooks sharing per-request state (the "vault").
 *   2. Streaming restoration that is correct even when a token like «V1» is split across two deltas:
 *      it holds back a tail that could be the start of a token and flushes it once the token closes.
 *   3. Disciplined lifecycle: state is created in the request hook and is ALWAYS torn down (on
 *      success or on error), which is the part most naive implementations get wrong.
 */

// requestId -> { byValue: Map<string,string>, byToken: Map<string,string>, seq: number }
const vaults = new Map();
// `${requestId}#${choiceIndex}` -> string held back between stream deltas
const pending = new Map();

const DETECTORS = {
	email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
	ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
	creditcard: /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}\b/g,
	phone: /\b\+?\d[\d ().-]{7,}\d\b/g,
};

const TOKEN_RE = /«V\d+»/g;

const configSchema = {
	safeParse(value) {
		const config =
			value && typeof value === "object" && !Array.isArray(value) ? value : {};
		const types = config.types ?? Object.keys(DETECTORS);
		if (
			!Array.isArray(types) ||
			types.some((t) => !Object.hasOwn(DETECTORS, t))
		) {
			return {
				success: false,
				error: new Error(
					`config.types must be a subset of: ${Object.keys(DETECTORS).join(", ")}`,
				),
			};
		}
		const scanRoles = config.scanRoles ?? ["user", "tool"];
		if (
			!Array.isArray(scanRoles) ||
			scanRoles.some((r) => typeof r !== "string")
		) {
			return {
				success: false,
				error: new Error("config.scanRoles must be an array of role names"),
			};
		}
		return {
			success: true,
			data: {
				detectors: types.map((t) => DETECTORS[t]),
				scanRoles: new Set(scanRoles),
			},
		};
	},
};

function maskText(text, vault, detectors) {
	let out = text;
	for (const re of detectors) {
		re.lastIndex = 0;
		out = out.replace(re, (match) => {
			let token = vault.byValue.get(match);
			if (!token) {
				vault.seq += 1;
				token = `«V${vault.seq}»`;
				vault.byValue.set(match, token);
				vault.byToken.set(token, match);
			}
			return token;
		});
	}
	return out;
}

function maskContent(content, vault, detectors) {
	if (typeof content === "string") return maskText(content, vault, detectors);
	if (Array.isArray(content))
		return content.map((part) =>
			part?.type === "text" && typeof part.text === "string"
				? { ...part, text: maskText(part.text, vault, detectors) }
				: part,
		);
	return content;
}

function unmask(text, vault) {
	if (!text) return text;
	return text.replace(TOKEN_RE, (token) => vault.byToken.get(token) ?? token);
}

export default defineExtension({
	key: "piivault",
	version: "1.0.0",
	label: "PII vault",
	description:
		"Tokenizes PII before it reaches the upstream model and restores it in the reply.",
	defaultCritical: false,
	configSchema,
	hooks: {
		onCanonicalRequest(ctx, request) {
			if (request.callType !== "chat") return request;
			const { detectors, scanRoles } = ctx.config;
			const vault = { byValue: new Map(), byToken: new Map(), seq: 0 };

			const messages = request.messages.map((message) =>
				scanRoles.has(message.role)
					? {
							...message,
							content: maskContent(message.content, vault, detectors),
						}
					: message,
			);

			if (vault.seq === 0) return request; // nothing to protect: stay invisible
			vaults.set(ctx.requestId, vault);
			ctx.log.debug("masked PII", {
				requestId: ctx.requestId,
				values: vault.seq,
			});
			return { ...request, messages };
		},

		onCanonicalResponse(ctx, response) {
			const vault = vaults.get(ctx.requestId);
			if (!vault) return response;
			vaults.delete(ctx.requestId); // non-stream: this is the only reply, tear down now
			return {
				...response,
				choices: response.choices.map((choice) => ({
					...choice,
					message: {
						...choice.message,
						content: unmask(choice.message.content, vault),
						reasoning: unmask(choice.message.reasoning, vault),
						refusal: unmask(choice.message.refusal, vault),
					},
				})),
			};
		},

		onStreamEvent(ctx, event) {
			const vault = vaults.get(ctx.requestId);
			if (!vault) return event;

			const choices = event.choices.map((choice) => {
				const key = `${ctx.requestId}#${choice.index}`;
				const incoming = choice.delta.content ?? "";
				const buffer = (pending.get(key) ?? "") + incoming;

				let emit;
				if (choice.finishReason !== null) {
					emit = buffer; // last chunk: flush everything we were holding
					pending.delete(key);
				} else {
					// A token is «V…». If the buffer ends inside an unclosed «…», hold from there: the
					// rest may arrive in the next delta. Everything before it is safe to emit.
					const open = buffer.lastIndexOf("«");
					if (open >= 0 && buffer.indexOf("»", open) === -1) {
						emit = buffer.slice(0, open);
						pending.set(key, buffer.slice(open));
					} else {
						emit = buffer;
						pending.set(key, "");
					}
				}

				const delta = { ...choice.delta };
				if (choice.delta.content !== undefined || emit !== "")
					delta.content = unmask(emit, vault);
				// reasoning/refusal deltas are restored directly (they rarely carry tokens; a split
				// there would only mean a token shows through in those side channels).
				if (choice.delta.reasoning !== undefined)
					delta.reasoning = unmask(choice.delta.reasoning, vault);
				if (choice.delta.refusal !== undefined)
					delta.refusal = unmask(choice.delta.refusal, vault);
				return { ...choice, delta };
			});

			// When every choice has finished, the vault is no longer needed.
			if (event.choices.every((c) => c.finishReason !== null))
				vaults.delete(ctx.requestId);

			return { ...event, choices };
		},

		onError(ctx) {
			// The request failed before it produced a (complete) reply: drop all per-request state so
			// the maps never grow unbounded.
			vaults.delete(ctx.requestId);
			for (const key of pending.keys())
				if (key.startsWith(`${ctx.requestId}#`)) pending.delete(key);
		},
	},
});
