import { createEnv } from "@t3-oss/env-core";
import * as z from "zod/v4";

const boolString = z.preprocess((value) => {
	if (typeof value !== "string") return value;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return value;
}, z.boolean());

const encryptionKeyringString = z.string().refine((raw) => {
	try {
		const parsed: unknown = JSON.parse(raw);
		return (
			parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed) &&
			Object.keys(parsed).length > 0 &&
			Object.keys(parsed).length <= 32 &&
			Object.entries(parsed).every(
				([id, key]) =>
					/^[A-Za-z0-9_-]{1,64}$/.test(id) &&
					typeof key === "string" &&
					/^[0-9a-fA-F]{64}$/.test(key),
			)
		);
	} catch {
		return false;
	}
}, "ENCRYPTION_KEYRING must be a JSON object of key ids to 64-character hex AES keys");

/**
 * Typed environment configuration with @t3-oss/env-core. Validated once on import; if anything is
 * missing or invalid the process fails fast with a clear error. Pure backend: every variable is a
 * `server` variable (no client/clientPrefix).
 *
 * Demo keys (GEMINI_API_KEY, OPENAI_API_KEY...) are intentionally NOT declared here: they are only
 * used by dev scripts and are read directly from process.env.
 */
export const env = createEnv({
	server: {
		PORT: z.coerce.number().int().positive().default(4000),
		/** Number of reverse-proxy hops allowed to append X-Forwarded-For. 0 ignores the header. */
		TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(16).default(0),
		/** Per-process anonymous model-catalog requests per minute and client IP. 0 disables it. */
		PUBLIC_MODELS_RPM: z.coerce.number().int().min(0).default(600),
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

		MASTER_KEY: z
			.string()
			.min(32, "MASTER_KEY must contain at least 32 characters"),
		ENCRYPTION_KEYRING: encryptionKeyringString,
		ACTIVE_ENCRYPTION_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),

		DATABASE_URL: z.url(),
		REDIS_URL: z.url(),

		OBSERVABILITY_SUCCESS_SAMPLE_RATE: z.coerce
			.number()
			.min(0)
			.max(1)
			.default(0.01),
		OBSERVABILITY_PAYLOAD_RETENTION_DAYS: z.coerce
			.number()
			.int()
			.positive()
			.default(7),
		OBSERVABILITY_METADATA_RETENTION_DAYS: z.coerce
			.number()
			.int()
			.positive()
			.default(30),
		OBSERVABILITY_PAYLOAD_MAX_BYTES: z.coerce
			.number()
			.int()
			.min(128)
			.default(32_768),
		/** 16x50 MB + mask/fields; uploads are streamed to temporary disk, not memory. */
		IMAGES_MAX_MULTIPART_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(805_000_000),
		/** Aggregate limit for the audio multipart (1 file + fields); streamed to temporary disk. */
		AUDIO_MAX_MULTIPART_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(30_000_000),

		SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

		/** Consecutive hook failures before an extension instance is disabled for this process. */
		BIFROST_EXTENSION_MAX_FAILURES: z.coerce
			.number()
			.int()
			.positive()
			.default(3),
		/** How often each replica polls the registry version to hot-reload extensions on change. */
		BIFROST_EXTENSIONS_RELOAD_INTERVAL_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(15_000),
		/** Maximum size of an uploaded extension module source, in bytes. */
		BIFROST_EXTENSIONS_MAX_CODE_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(1_000_000),
		/** Per-hook wall-clock budget in ms. A hook exceeding it is aborted and counts as a failure. 0 disables the timeout. */
		BIFROST_EXTENSION_HOOK_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.min(0)
			.default(5_000),

		RESPONSES_STATE_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
		/** Interval for the in-app response_states GC job that deletes expired rows. */
		RESPONSE_STATE_GC_INTERVAL_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(3_600_000),
		/** Default for `store` when the client omits it. true = OpenAI-compatible; set false for privacy-first. */
		RESPONSES_STORE_DEFAULT: boolString.default(true),
		RESPONSES_WEBSOCKET_MAX_CONNECTIONS: z.coerce
			.number()
			.int()
			.positive()
			.default(1000),
		RESPONSES_WEBSOCKET_MAX_CONNECTIONS_PER_KEY: z.coerce
			.number()
			.int()
			.positive()
			.default(20),
		RESPONSES_WEBSOCKET_MAX_QUEUED_TURNS: z.coerce
			.number()
			.int()
			.positive()
			.default(64),

		OBJECT_STORAGE_BACKEND: z
			.enum(["disabled", "local", "s3"])
			.default("disabled"),
		OBJECT_STORAGE_LOCAL_ROOT: z
			.string()
			.min(1)
			.default(".source/object-storage"),
		OBJECT_STORAGE_S3_BUCKET: z.string().min(1).optional(),
		OBJECT_STORAGE_S3_ENDPOINT: z.url().optional(),
		OBJECT_STORAGE_S3_REGION: z.string().min(1).default("auto"),
		OBJECT_STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
		OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
		OBJECT_STORAGE_S3_FORCE_PATH_STYLE: boolString.default(false),

		VIDEOS_ASSET_RETENTION_HOURS: z.coerce
			.number()
			.int()
			.positive()
			.default(24),
		VIDEO_JOB_POLL_INTERVAL_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(10_000),
		VIDEO_JOB_POLL_BATCH_SIZE: z.coerce.number().int().positive().default(10),
		VIDEO_JOB_MAX_RUNTIME_MINUTES: z.coerce
			.number()
			.int()
			.positive()
			.default(60),

		OTEL_ENABLED: boolString.default(false),
		OTEL_SERVICE_NAME: z.string().min(1).default("bifrost"),
		OTEL_METRIC_EXPORT_INTERVAL_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(60_000),
	},

	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
