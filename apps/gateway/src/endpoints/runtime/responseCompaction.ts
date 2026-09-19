import {
	parseEncryptedEnvelope,
	decryptJson,
	encryptJson,
} from "#db/crypto.ts";

const COMPACTION_PREFIX = "ugcmp_2.";
const COMPACTION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface CompactionPayload {
	version: 2;
	summary: string;
	expiresAt: number;
}

export function encodeCompactionSummary(summary: string): string {
	const envelope = encryptJson(
		{
			version: 2,
			summary,
			expiresAt: Date.now() + COMPACTION_TTL_MS,
		} satisfies CompactionPayload,
		"response-compaction",
	);
	return `${COMPACTION_PREFIX}${Buffer.from(JSON.stringify(envelope)).toString("base64url")}`;
}

export function decodeCompactionSummary(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.startsWith(COMPACTION_PREFIX)) {
		return undefined;
	}
	try {
		const encoded = value.slice(COMPACTION_PREFIX.length);
		const envelope = parseEncryptedEnvelope(
			JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
		);
		const decoded = decryptJson(envelope, "response-compaction");
		if (
			decoded === null ||
			typeof decoded !== "object" ||
			Array.isArray(decoded)
		) {
			return undefined;
		}
		const payload = decoded as Partial<CompactionPayload>;
		const { version, summary, expiresAt } = payload;
		return version === 2 &&
			typeof summary === "string" &&
			typeof expiresAt === "number" &&
			expiresAt > Date.now()
			? summary
			: undefined;
	} catch {
		return undefined;
	}
}

export function expandLocalCompactionItems(
	items: Record<string, unknown>[],
): Record<string, unknown>[] {
	return items.flatMap((item) => {
		if (item.type !== "compaction") {
			return [item];
		}
		const summary = decodeCompactionSummary(item.encrypted_content);
		if (summary === undefined) {
			return [item];
		}
		return [
			{
				type: "message",
				role: "developer",
				content: [{ type: "input_text", text: summary }],
			},
		];
	});
}
