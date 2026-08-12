import { defineExtension } from "#extensions/sdk.ts";
import sharp from "sharp";

/*
 * Tiered image watermark — visible "PREVIEW" stamp for non-privileged keys.
 * ---------------------------------------------------------------------------
 * Composites a diagonal, semi-transparent watermark over generated images UNLESS the caller is on a
 * privileged tier (the master key, or a virtual key whose name is allow-listed). This is the classic
 * "free tier gets watermarked previews, paid tier gets clean files" pattern — enforced at the gateway
 * so no upstream provider or downstream app has to implement it.
 *
 * Hook used: onImageOutput.
 *
 * Why this is interesting:
 *   - It is the only example that branches on ctx.auth, turning identity into a per-request policy.
 *   - Unlike metadata stamping, a VISIBLE overlay legitimately requires a re-encode (we are changing
 *     pixels), which is exactly what onImageOutput's full ExtensionImageOutput contract is for.
 */

const configSchema = {
	safeParse(value) {
		const config =
			value && typeof value === "object" && !Array.isArray(value) ? value : {};
		const text = config.text ?? "PREVIEW";
		if (typeof text !== "string" || text.length === 0 || text.length > 32) {
			return {
				success: false,
				error: new Error(
					"config.text must be a non-empty string up to 32 chars",
				),
			};
		}
		const allowlist = config.allowlist ?? [];
		if (
			!Array.isArray(allowlist) ||
			allowlist.some((n) => typeof n !== "string")
		) {
			return {
				success: false,
				error: new Error(
					"config.allowlist must be an array of virtual key names",
				),
			};
		}
		const opacity = config.opacity ?? 0.28;
		if (typeof opacity !== "number" || opacity < 0 || opacity > 1) {
			return {
				success: false,
				error: new Error("config.opacity must be a number from 0 to 1"),
			};
		}
		return {
			success: true,
			data: {
				text,
				allowlist: new Set(allowlist),
				opacity,
				watermarkMaster: config.watermarkMaster === true, // default: master is exempt
			},
		};
	},
};

function isPrivileged(ctx) {
	if (ctx.auth.type === "master") return !ctx.config.watermarkMaster;
	return (
		ctx.auth.virtualKeyName !== undefined &&
		ctx.config.allowlist.has(ctx.auth.virtualKeyName)
	);
}

function escapeXml(value) {
	return String(value).replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&apos;",
			})[c],
	);
}

// A repeating diagonal band of text, sized to the image.
function watermarkSvg(width, height, text, opacity) {
	const label = escapeXml(text);
	const fontSize = Math.max(16, Math.round(width / 12));
	const step = fontSize * 6;
	const rows = [];
	for (let y = 0; y < height + step; y += step) {
		rows.push(
			`<text x="0" y="${y}" font-family="sans-serif" font-size="${fontSize}" ` +
				`fill="#ffffff" fill-opacity="${opacity}" ` +
				`stroke="#000000" stroke-opacity="${opacity / 2}" stroke-width="1">` +
				`${(`${label} `).repeat(8)}</text>`,
		);
	}
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
			`<g transform="rotate(-30 ${width / 2} ${height / 2})">${rows.join("")}</g></svg>`,
	);
}

export default defineExtension({
	key: "tieredimagewatermark",
	version: "1.0.0",
	label: "Tiered image watermark",
	description:
		"Stamps a visible preview watermark on images for non-privileged keys.",
	defaultCritical: false,
	configSchema,
	hooks: {
		async onImageOutput(ctx, output) {
			if (isPrivileged(ctx)) return output;
			try {
				const svg = watermarkSvg(
					output.width,
					output.height,
					ctx.config.text,
					ctx.config.opacity,
				);
				let pipeline = sharp(Buffer.from(output.data)).composite([
					{ input: svg, top: 0, left: 0 },
				]);
				if (output.format === "jpeg") pipeline = pipeline.jpeg({ quality: 90 });
				else if (output.format === "webp")
					pipeline = pipeline.webp({ quality: 90 });
				else pipeline = pipeline.png();
				const data = await pipeline.toBuffer();
				return { ...output, data: new Uint8Array(data) };
			} catch (err) {
				// A watermarking failure must never fail the image; serve it un-watermarked and warn.
				ctx.log.warn("image watermarking failed; serving original", {
					requestId: ctx.requestId,
					err: err instanceof Error ? err.message : String(err),
				});
				return output;
			}
		},
	},
});
