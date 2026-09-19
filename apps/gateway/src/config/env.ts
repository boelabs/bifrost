import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

const boolString = z.preprocess((value) => {
	if (typeof value !== "string") {
		return value;
	}
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}
	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}
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

		/**
		 * Apply pending migrations at boot, before the server listens. On by default because the
		 * alternative — a separate job someone has to sequence — is the step that gets forgotten, and
		 * a platform that runs a "pre-deployment" hook usually runs it in the OUTGOING container,
		 * which does not even contain the new migration files.
		 *
		 * Every replica does this behind an advisory lock, so they serialise rather than race. A
		 * failure is fatal: the process exits instead of serving against a schema it does not
		 * understand, which leaves a rolling update on the previous version.
		 */
		MIGRATE_ON_BOOT: boolString.default(true),

		DATABASE_URL: z.url(),
		REDIS_URL: z.url(),

		/**
		 * Who may read a retained request/response sample.
		 *
		 * `open` - a role with `payloads:read` can decrypt one, and every read is audited.
		 * `sealed` - nobody can, through any credential: the gateway keeps capturing samples and
		 * keeps them encrypted at rest, but `GET /admin/logs/:id/payload` refuses before it touches
		 * the envelope, and the attempt is audited. It is a deployment-level decision on purpose -
		 * an environment variable cannot be flipped by a compromised operator account.
		 *
		 * The key that seals a sample still lives in this process, so `sealed` is an access policy,
		 * not a cryptographic guarantee against the gateway itself.
		 */
		OBSERVABILITY_PAYLOAD_ACCESS: z.enum(["open", "sealed"]).default("open"),
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
		/**
		 * The admin audit trail outlives operation metadata on purpose: it is the record of who changed
		 * the gateway, which is the kind of question asked months later, and one row per configuration
		 * change is nothing next to one row per request.
		 */
		ADMIN_AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
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

		/**
		 * How long the process keeps serving normally after SIGTERM while `/health/ready` already
		 * answers 503. It is the time the load balancer needs to notice and stop routing here; set it
		 * to a few health-check intervals. 0 disables the wait, which is why the default is 0 outside
		 * production: there is no proxy in front of `bun run dev`, and a Ctrl-C that takes fifteen
		 * seconds to return the prompt is a bug in the developer's day.
		 */
		DRAIN_DELAY_MS: z.coerce
			.number()
			.int()
			.min(0)
			.default(process.env.NODE_ENV === "production" ? 15_000 : 0),
		/**
		 * Grace given to in-flight requests once the listener is closed. It has to cover the longest
		 * response this gateway serves, which for a streamed completion is minutes, not seconds — a
		 * short value here cancels live streams on every deployment.
		 */
		SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

		/** Consecutive hook failures before an extension instance is disabled for this process. */
		EXTENSIONS_MAX_FAILURES: z.coerce.number().int().positive().default(3),
		/** How often each replica polls the registry version to hot-reload extensions on change. */
		EXTENSIONS_RELOAD_INTERVAL_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(15_000),
		/** Maximum size of an uploaded extension module source, in bytes. */
		EXTENSIONS_MAX_CODE_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(1_000_000),
		/** Per-hook wall-clock budget in ms. A hook exceeding it is aborted and counts as a failure. 0 disables the timeout. */
		EXTENSIONS_HOOK_TIMEOUT_MS: z.coerce.number().int().min(0).default(5000),

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

		/** One connection string; see storage/config.ts. Unset means no object storage. */
		OBJECT_STORAGE_URL: z.string().optional(),

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

		/**
		 * Human (dashboard) authentication. Disabled by default: with DASH_ENABLED=false the gateway
		 * never mounts /auth or /admin/users and behaves exactly as a keys-only deployment. The
		 * dashboard tables still exist — they are simply empty.
		 */
		DASH_ENABLED: boolString.default(false),
		/** Root operator. Lives in the environment, never in the database, so lockout is impossible. */
		DASH_ROOT_USER: z.string().min(1).optional(),
		/** Root password. Falls back to MASTER_KEY when unset; set it to decouple both rotations. */
		DASH_ROOT_PASSWORD: z.string().min(12).optional(),
	},

	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

if (env.DASH_ENABLED && !env.DASH_ROOT_USER) {
	throw new Error(
		"Missing environment variables for the dashboard:\n" +
			"  DASH_ROOT_USER   (required)\n" +
			"  DASH_ROOT_PASSWORD (optional; falls back to MASTER_KEY)\n" +
			"Set them, or set DASH_ENABLED=false to run the gateway without human authentication.",
	);
}

/** Root credentials, resolved once. Null when the dashboard is disabled. */
export const rootCredentials: { user: string; password: string } | null =
	env.DASH_ENABLED && env.DASH_ROOT_USER
		? {
				user: env.DASH_ROOT_USER,
				password: env.DASH_ROOT_PASSWORD ?? env.MASTER_KEY,
			}
		: null;
