import { defineExtension } from "#extensions/sdk.ts";

/*
 * Prompt-injection firewall.
 * ---------------------------------------------------------------------------
 * Scans inbound user/tool text for known prompt-injection and jailbreak phrases BEFORE the request
 * reaches the upstream model, and either neutralizes the offending span ("sanitize") or rejects the
 * whole request ("block").
 *
 * Hook used: onCanonicalRequest. Because it runs on the canonical request, a single instance protects
 * every public wire at once: /v1/chat/completions, /v1/responses and /v1/messages.
 *
 * Why this is interesting: it shows a hook that can MUTATE the request in place and a hook that can
 * ABORT it. Throwing from a hook fails the request — see the note on status codes in the README.
 */

// Curated default heuristics. These are intentionally conservative (high precision, low recall): a
// firewall that mangles legitimate prompts is worse than one that misses an exotic attack.
const DEFAULT_PATTERNS = [
	/ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|messages?)/i,
	/disregard\s+(?:the\s+)?(?:above|previous|earlier|system)\b/i,
	/(?:reveal|print|repeat|show|leak)\s+(?:your\s+|the\s+)?(?:system\s+prompt|hidden\s+instructions?|initial\s+prompt)/i,
	/you\s+are\s+now\s+(?:DAN|in\s+developer\s+mode|an?\s+unrestricted)/i,
	/pretend\s+(?:you\s+are|to\s+be)\s+(?:an?\s+)?(?:unfiltered|jailbroken|uncensored)/i,
];

// Per-instance compiled state, cached by the (stable) config object identity so we compile once.
const compiledByConfig = new WeakMap();

const configSchema = {
	safeParse(value) {
		const config =
			value && typeof value === "object" && !Array.isArray(value) ? value : {};

		const action = config.action ?? "sanitize";
		if (action !== "sanitize" && action !== "block") {
			return {
				success: false,
				error: new Error('config.action must be "sanitize" or "block"'),
			};
		}

		const extra = config.extraPatterns ?? [];
		if (
			!Array.isArray(extra) ||
			extra.some((p) => typeof p !== "string" || p === "")
		) {
			return {
				success: false,
				error: new Error(
					"config.extraPatterns must be an array of regex strings",
				),
			};
		}
		// Validate every extra pattern compiles, so a typo fails at startup, not at request time.
		for (const p of extra) {
			try {
				new RegExp(p, "i");
			} catch (err) {
				return {
					success: false,
					error: new Error(
						`config.extraPatterns: invalid regex ${p}: ${err.message}`,
					),
				};
			}
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

		const replacement =
			typeof config.replacement === "string" ? config.replacement : "[blocked]";

		return {
			success: true,
			data: {
				action,
				extraPatterns: extra,
				scanRoles: new Set(scanRoles),
				replacement,
			},
		};
	},
};

function patternsFor(config) {
	let compiled = compiledByConfig.get(config);
	if (!compiled) {
		compiled = [
			...DEFAULT_PATTERNS,
			...config.extraPatterns.map((p) => new RegExp(p, "gi")),
		].map(
			(re) =>
				new RegExp(
					re.source,
					re.flags.includes("g") ? re.flags : `${re.flags}g`,
				),
		);
		compiledByConfig.set(config, compiled);
	}
	return compiled;
}

// Applies the firewall to one text span. Returns { text, hits }.
function scan(text, patterns, replacement) {
	let out = text;
	let hits = 0;
	for (const re of patterns) {
		re.lastIndex = 0;
		out = out.replace(re, () => {
			hits += 1;
			return replacement;
		});
	}
	return { text: out, hits };
}

function scanContent(content, patterns, replacement) {
	if (typeof content === "string") {
		const { text, hits } = scan(content, patterns, replacement);
		return { content: text, hits };
	}
	if (Array.isArray(content)) {
		let hits = 0;
		const parts = content.map((part) => {
			if (part?.type !== "text" || typeof part.text !== "string") return part;
			const res = scan(part.text, patterns, replacement);
			hits += res.hits;
			return { ...part, text: res.text };
		});
		return { content: parts, hits };
	}
	return { content, hits: 0 };
}

export default defineExtension({
	key: "promptfirewall",
	version: "1.0.0",
	label: "Prompt-injection firewall",
	description:
		"Detects and neutralizes (or blocks) prompt-injection attempts in inbound text.",
	defaultCritical: false,
	configSchema,
	hooks: {
		onCanonicalRequest(ctx, request) {
			if (request.callType !== "chat") return request;
			const { action, scanRoles, replacement } = ctx.config;
			const patterns = patternsFor(ctx.config);

			let total = 0;
			const messages = request.messages.map((message) => {
				if (!scanRoles.has(message.role)) return message;
				const { content, hits } = scanContent(
					message.content,
					patterns,
					replacement,
				);
				total += hits;
				return hits > 0 ? { ...message, content } : message;
			});

			if (total === 0) return request;

			if (action === "block") {
				// NOTE: today this surfaces to the client as a 500 (the runtime wraps hook errors as
				// server errors). It still blocks the call. See the README "Blocking" caveat.
				throw new Error(
					`prompt-firewall blocked ${total} injection pattern(s) in the request`,
				);
			}

			ctx.log.warn("neutralized prompt-injection attempt", {
				requestId: ctx.requestId,
				hits: total,
			});
			return { ...request, messages };
		},
	},
});
