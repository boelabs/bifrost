import type { OperationProfiles, TransportOverrides } from "#profiles/types.ts";
import type { TextCapabilities, ReasoningSpec } from "#core/reasoning.ts";
import type { EmbeddingProfile } from "#core/embeddings.ts";
import type { ImageModelProfile } from "#core/images.ts";
import type { VideoModelProfile } from "#core/videos.ts";
import type { CatalogEntry } from "#catalog/types.ts";
import type { RerankProfile } from "#core/rerank.ts";
import type { CallType } from "#core/callType.ts";
import type { EncEnvelope } from "./crypto.ts";
import { sql } from "drizzle-orm";

import {
	uniqueIndex,
	timestamp,
	smallint,
	pgTable,
	integer,
	boolean,
	numeric,
	pgEnum,
	jsonb,
	index,
	check,
	uuid,
	text,
} from "drizzle-orm/pg-core";

import {
	DEFAULT_EXECUTION_POLICIES,
	type ExecutionPolicies,
} from "#core/executionPolicy.ts";

/* ------------------------------------------------------------------ enums */

export const routingStrategyEnum = pgEnum("routing_strategy", [
	"simple-shuffle",
	"least-busy",
	"usage-based-tpm",
	"usage-based-rpm",
	"latency-based",
	"throughput-based",
	"price-based",
	"health-aware",
]);

export const unsupportedParameterStrategyEnum = pgEnum(
	"unsupported_parameter_strategy",
	["drop", "error", "allow"],
);

export const budgetResetEnum = pgEnum("budget_reset", [
	"hourly",
	"daily",
	"weekly",
	"monthly",
]);

export const fallbackReasonEnum = pgEnum("fallback_reason", [
	"general",
	"context_window",
	"content_policy",
]);

export const extensionArtifactStatusEnum = pgEnum("extension_artifact_status", [
	"active",
	"archived",
]);

export const videoStatusEnum = pgEnum("video_status", [
	"queued",
	"in_progress",
	"completed",
	"failed",
	"deleted",
]);

export const videoAssetVariantEnum = pgEnum("video_asset_variant", [
	"video",
	"thumbnail",
	"spritesheet",
]);

export const operationLifecycleStateEnum = pgEnum("operation_lifecycle_state", [
	"in_progress",
	"finished",
]);

export const operationOutcomeEnum = pgEnum("operation_outcome", [
	"success",
	"incomplete",
	"blocked",
	"error",
	"cancelled",
	"abandoned",
	"unknown",
]);

export const attemptOutcomeEnum = pgEnum("attempt_outcome", [
	"in_progress",
	"success",
	"incomplete",
	"blocked",
	"error",
	"cancelled",
	"abandoned",
	"unknown",
]);

/* ----------------------------------------------------------------- types */

/** Model metadata: pricing, limits, supported modalities. Used by the cost calc. */
export interface RuntimeModelMetadata {
	pricing?: {
		/** Cost in USD cents per 1M input tokens. */
		inputCentsPerMTokens?: number;
		/** Cost in USD cents per 1M output tokens. */
		outputCentsPerMTokens?: number;
		/** Cost in USD cents per 1M tokens read from cache. */
		cacheReadCentsPerMTokens?: number;
		/** Cost in USD cents per 1M tokens written to cache (cache creation). */
		cacheWriteCentsPerMTokens?: number;
		/** Cost in USD cents per reranking search unit. */
		searchUnitCents?: number;
		/**
		 * TIERED rate by context size. When the input tokens (promptTokens, which include cache
		 * read/write) exceed `aboveInputTokens`, the WHOLE request is charged at the tier's rates
		 * (a step function, not marginal). E.g. GPT-5.5 >272k, Gemini Pro >200k, MiniMax-M3 >512k.
		 * The highest `aboveInputTokens` tier the prompt exceeds is chosen; fields not defined in the
		 * tier inherit the already-resolved base rate.
		 */
		tiers?: Array<{
			aboveInputTokens: number;
			inputCentsPerMTokens?: number;
			outputCentsPerMTokens?: number;
			cacheReadCentsPerMTokens?: number;
			cacheWriteCentsPerMTokens?: number;
		}>;
	};
	maxInputTokens?: number;
	maxOutputTokens?: number;
	/** Internal call categories derived from the declared operations. */
	supportedCallTypes?: CallType[];
	/** Image profile flattened for runtime compatibility. */
	image?: ImageModelProfile;
	/** Video profile flattened for runtime compatibility. */
	video?: VideoModelProfile;
	/** Embeddings profile flattened for runtime compatibility. */
	embedding?: EmbeddingProfile;
	/** Reranking profile flattened for runtime compatibility. */
	rerank?: RerankProfile;
	/** Per-operation profiles of the new admin model. */
	operations?: OperationProfiles;
	/** Override of the catalog capabilities (partial: only what you want to force). */
	capabilities?: Partial<TextCapabilities>;
	/** Override of the catalog's reasoning control. */
	reasoning?: ReasoningSpec;
	[k: string]: unknown;
}

/* ------------------------------------------------------ model_deployments */

/**
 * An executable deployment: adapter, upstream model, and encrypted credentials. Built-ins read
 * metadata from catalog.json; custom ones store a 1:1 CatalogEntry. Several rows with the same
 * public_model form a balanced pool for the public name requested by the client.
 */
export const modelDeployments = pgTable(
	"model_deployments",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		/** Public name the client sends in `model`. */
		publicModel: text("public_model").notNull(),
		/** Code adapter that talks to the provider (openai, anthropic, googleaistudio...). */
		adapterKey: text("adapter_key").notNull(),
		/** Exact upstream ID sent to the provider. */
		upstreamModel: text("upstream_model").notNull(),
		/** Operator-facing human label to tell deployments of the same pool apart (e.g. which API key). */
		label: text("label"),
		/**
		 * Optional shared capacity/quota domain. Deployments with the same value share throttle
		 * circuit state, preventing retries across rows backed by the same provider account.
		 */
		failureDomain: text("failure_domain"),
		/** Free-form operator annotations (team, environment, key alias, rotation date, notes...). */
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		/** Purpose-bound, key-versioned AES-256-GCM credentials envelope. */
		credentials: jsonb("credentials").$type<EncEnvelope>().notNull(),
		/** Inline CatalogEntry for custom models. NULL = the model is in the built-in catalog. */
		catalogEntry: jsonb("catalog_entry").$type<CatalogEntry>(),
		/** Operator's pricing for cost calculation. NULL = use the catalog's if it exists. */
		pricing: jsonb("pricing").$type<RuntimeModelMetadata["pricing"]>(),
		/** Per-operation transports that replace the adapter-inferred default. */
		transportOverrides: jsonb("transport_overrides")
			.$type<TransportOverrides>()
			.notNull()
			.default({}),
		enabled: boolean("enabled").notNull().default(true),
		/** Weight for simple-shuffle balancing. */
		weight: integer("weight").notNull().default(1),
		tpmLimit: integer("tpm_limit"),
		rpmLimit: integer("rpm_limit"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("model_deployments_public_model_idx").on(t.publicModel),
		index("model_deployments_adapter_key_idx").on(t.adapterKey),
		check(
			"model_deployments_adapter_key_format",
			sql`${t.adapterKey} ~ '^[a-z0-9]+$'`,
		),
	],
);

/* ------------------------------------------------------- router_settings */

/** Singleton (id = 1). The router's global config. */
export const routerSettings = pgTable(
	"router_settings",
	{
		id: smallint("id").primaryKey().default(1),
		routingStrategy: routingStrategyEnum("routing_strategy")
			.notNull()
			.default("simple-shuffle"),
		allowedFails: integer("allowed_fails").notNull().default(3),
		cooldownSeconds: integer("cooldown_seconds").notNull().default(5),
		failureWindowSeconds: integer("failure_window_seconds")
			.notNull()
			.default(60),
		maxCooldownSeconds: integer("max_cooldown_seconds").notNull().default(300),
		halfOpenProbeSeconds: integer("half_open_probe_seconds")
			.notNull()
			.default(30),
		configurationCooldownSeconds: integer("configuration_cooldown_seconds")
			.notNull()
			.default(300),
		throttleCooldownSeconds: integer("throttle_cooldown_seconds")
			.notNull()
			.default(5),
		executionPolicies: jsonb("execution_policies")
			.$type<ExecutionPolicies>()
			.notNull()
			.default(DEFAULT_EXECUTION_POLICIES),
		retryAfterSeconds: integer("retry_after_seconds").notNull().default(0),
		unsupportedParameterStrategy: unsupportedParameterStrategyEnum(
			"unsupported_parameter_strategy",
		)
			.notNull()
			.default("drop"),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		check("router_settings_id_singleton", sql`${t.id} = 1`),
		check("router_settings_allowed_fails_valid", sql`${t.allowedFails} >= 0`),
		check(
			"router_settings_cooldown_seconds_valid",
			sql`${t.cooldownSeconds} >= 0`,
		),
		check(
			"router_settings_failure_window_seconds_valid",
			sql`${t.failureWindowSeconds} > 0`,
		),
		check(
			"router_settings_max_cooldown_seconds_valid",
			sql`${t.maxCooldownSeconds} > 0`,
		),
		check(
			"router_settings_half_open_probe_seconds_valid",
			sql`${t.halfOpenProbeSeconds} > 0`,
		),
		check(
			"router_settings_configuration_cooldown_seconds_valid",
			sql`${t.configurationCooldownSeconds} > 0`,
		),
		check(
			"router_settings_throttle_cooldown_seconds_valid",
			sql`${t.throttleCooldownSeconds} > 0`,
		),
		check(
			"router_settings_retry_after_seconds_valid",
			sql`${t.retryAfterSeconds} >= 0`,
		),
	],
);

/* ------------------------------------------------------ fallback_policies */

export const fallbackPolicies = pgTable(
	"fallback_policies",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		primaryModel: text("primary_model").notNull(),
		/** Ordered chain of fallback public names (max 5, enforced in SQL). */
		fallbackModels: text("fallback_models").array().notNull(),
		/** Aggregate cause of the primary failure; it does not represent an operation. */
		reason: fallbackReasonEnum("reason").notNull().default("general"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("fallback_policies_primary_reason_idx").on(
			t.primaryModel,
			t.reason,
		),
		check(
			"fallback_policies_models_max5",
			sql`cardinality(${t.fallbackModels}) BETWEEN 1 AND 5`,
		),
		check(
			"fallback_policies_primary_not_in_models",
			sql`NOT (${t.primaryModel} = ANY(${t.fallbackModels}))`,
		),
	],
);

/* ----------------------------------------------------------- virtual_keys */

export const virtualKeys = pgTable(
	"virtual_keys",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		/** SHA-256 (hex) of the key. The plaintext key is only shown when created. */
		keyHash: text("key_hash").notNull(),
		/** Readable prefix to show in UIs/logs, e.g. "unified-AbCd". */
		keyPrefix: text("key_prefix").notNull(),
		name: text("name").notNull(),
		/** Allowed public models. [] = all. */
		allowedModels: text("allowed_models").array().notNull().default([]),
		/** Maximum budget in USD cents. null = no limit. */
		maxBudgetCents: integer("max_budget_cents"),
		/** Budget reset period. null = never. */
		budgetReset: budgetResetEnum("budget_reset"),
		budgetResetAt: timestamp("budget_reset_at", { withTimezone: true }),
		spendCents: numeric("spend_cents", { precision: 20, scale: 10 })
			.notNull()
			.default("0"),
		tpm: integer("tpm"),
		rpm: integer("rpm"),
		enabled: boolean("enabled").notNull().default(true),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [uniqueIndex("virtual_keys_key_hash_idx").on(t.keyHash)],
);

/* ------------------------------------------------------ gateway_operations */

/**
 * Provider-agnostic lifecycle projection. A row exists while work is in flight and success requires
 * verified semantic termination.
 */
export const gatewayOperations = pgTable(
	"gateway_operations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		requestId: text("request_id").notNull(),
		virtualKeyId: uuid("virtual_key_id"),
		publicModel: text("public_model"),
		callType: text("call_type").notNull(),
		lifecycleState: operationLifecycleStateEnum("lifecycle_state")
			.notNull()
			.default("in_progress"),
		outcome: operationOutcomeEnum("outcome"),
		degraded: boolean("degraded").notNull().default(false),
		terminalVerified: boolean("terminal_verified").notNull().default(false),
		stream: boolean("stream").notNull().default(false),
		cacheHit: boolean("cache_hit").notNull().default(false),
		httpStatus: integer("http_status"),
		promptTokens: integer("prompt_tokens"),
		completionTokens: integer("completion_tokens"),
		reasoningTokens: integer("reasoning_tokens"),
		cacheReadTokens: integer("cache_read_tokens"),
		cacheWriteTokens: integer("cache_write_tokens"),
		totalTokens: integer("total_tokens"),
		searchUnits: integer("search_units"),
		consumerCostCents: numeric("consumer_cost_cents", {
			precision: 20,
			scale: 10,
		}),
		upstreamCostCents: numeric("upstream_cost_cents", {
			precision: 20,
			scale: 10,
		}),
		durationMs: integer("duration_ms"),
		firstEventMs: integer("first_event_ms"),
		firstReasoningMs: integer("first_reasoning_ms"),
		firstOutputMs: integer("first_output_ms"),
		maxInterEventGapMs: integer("max_inter_event_gap_ms"),
		downstreamBlockedMs: integer("downstream_blocked_ms"),
		upstreamBytes: integer("upstream_bytes"),
		downstreamBytes: integer("downstream_bytes"),
		lastProgressAt: timestamp("last_progress_at", { withTimezone: true }),
		startedAt: timestamp("started_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		endedAt: timestamp("ended_at", { withTimezone: true }),
		requestSummary: jsonb("request_summary").notNull().default({}),
		responseSummary: jsonb("response_summary").notNull().default({}),
		reasoning: jsonb("reasoning"),
		metadata: jsonb("metadata").notNull().default({}),
		error: jsonb("error"),
	},
	(t) => [
		index("gateway_operations_request_id_idx").on(t.requestId),
		index("gateway_operations_started_at_idx").on(t.startedAt),
		index("gateway_operations_model_idx").on(t.publicModel),
		index("gateway_operations_outcome_idx").on(t.outcome),
		index("gateway_operations_active_idx").on(
			t.lifecycleState,
			t.lastProgressAt,
		),
		check(
			"gateway_operations_verified_terminal",
			sql`${t.outcome} IS NULL OR ${t.outcome} NOT IN ('success', 'incomplete', 'blocked') OR ${t.terminalVerified}`,
		),
	],
);

export const upstreamAttempts = pgTable(
	"upstream_attempts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		operationId: uuid("operation_id").notNull(),
		ordinal: integer("ordinal").notNull(),
		deploymentId: uuid("deployment_id"),
		deploymentLabel: text("deployment_label"),
		adapterKey: text("adapter_key"),
		transport: text("transport"),
		upstreamModel: text("upstream_model"),
		outcome: attemptOutcomeEnum("outcome").notNull(),
		terminalVerified: boolean("terminal_verified").notNull().default(false),
		transportTerminator: text("transport_terminator"),
		failureOwner: text("failure_owner"),
		failureKind: text("failure_kind"),
		failurePhase: text("failure_phase"),
		healthEffect: text("health_effect").notNull().default("neutral"),
		httpStatus: integer("http_status"),
		providerStatus: integer("provider_status"),
		durationMs: integer("duration_ms"),
		headersMs: integer("headers_ms"),
		firstEventMs: integer("first_event_ms"),
		firstReasoningMs: integer("first_reasoning_ms"),
		firstOutputMs: integer("first_output_ms"),
		maxInterEventGapMs: integer("max_inter_event_gap_ms"),
		downstreamBlockedMs: integer("downstream_blocked_ms"),
		upstreamBytes: integer("upstream_bytes"),
		downstreamBytes: integer("downstream_bytes"),
		frames: integer("frames"),
		metadataFrames: integer("metadata_frames"),
		reasoningFrames: integer("reasoning_frames"),
		contentFrames: integer("content_frames"),
		toolFrames: integer("tool_frames"),
		mediaFrames: integer("media_frames"),
		usageFrames: integer("usage_frames"),
		promptTokens: integer("prompt_tokens"),
		completionTokens: integer("completion_tokens"),
		reasoningTokens: integer("reasoning_tokens"),
		cacheReadTokens: integer("cache_read_tokens"),
		cacheWriteTokens: integer("cache_write_tokens"),
		totalTokens: integer("total_tokens"),
		searchUnits: integer("search_units"),
		lastProgressAt: timestamp("last_progress_at", { withTimezone: true }),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		endedAt: timestamp("ended_at", { withTimezone: true }),
		diagnostics: jsonb("diagnostics").notNull().default({}),
		error: jsonb("error"),
	},
	(t) => [
		uniqueIndex("upstream_attempts_operation_idx").on(t.operationId, t.ordinal),
		index("upstream_attempts_deployment_idx").on(t.deploymentId, t.startedAt),
	],
);

export const payloadSamples = pgTable(
	"payload_samples",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		operationId: uuid("operation_id").notNull(),
		captureReason: text("capture_reason").notNull(),
		envelope: jsonb("envelope").$type<EncEnvelope>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		accessedAt: timestamp("accessed_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("payload_samples_operation_idx").on(t.operationId),
		index("payload_samples_expires_at_idx").on(t.expiresAt),
	],
);

export const payloadAccessAudit = pgTable(
	"payload_access_audit",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		operationId: uuid("operation_id").notNull(),
		requestId: text("request_id").notNull(),
		actor: text("actor").notNull(),
		found: boolean("found").notNull(),
		accessedAt: timestamp("accessed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("payload_access_audit_operation_idx").on(t.operationId)],
);

/* --------------------------------------------------------- response_states */

/**
 * Local canonical state of /v1/responses. Not observability: used to reconstruct
 * previous_response_id without depending on the upstream. Rows with store=false are internal-only
 * minimal opaque provider state, not public response storage.
 */
export const responseStates = pgTable(
	"response_states",
	{
		id: text("id").primaryKey(),
		virtualKeyId: uuid("virtual_key_id"),
		publicModel: text("public_model").notNull(),
		deploymentId: uuid("deployment_id"),
		adapterKey: text("adapter_key"),
		previousResponseId: text("previous_response_id"),
		store: boolean("store").notNull().default(true),
		requestInput: jsonb("request_input")
			.$type<Record<string, unknown>[]>()
			.notNull(),
		output: jsonb("output").$type<Record<string, unknown>[]>().notNull(),
		response: jsonb("response").$type<Record<string, unknown>>().notNull(),
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		index("response_states_virtual_key_idx").on(t.virtualKeyId),
		index("response_states_public_model_idx").on(t.publicModel),
		index("response_states_previous_response_idx").on(t.previousResponseId),
		index("response_states_expires_at_idx").on(t.expiresAt),
		check(
			"response_states_adapter_key_format",
			sql`${t.adapterKey} IS NULL OR ${t.adapterKey} ~ '^[a-z0-9]+$'`,
		),
	],
);

/* -------------------------------------------------------------- video_jobs */

export const videoJobs = pgTable(
	"video_jobs",
	{
		id: text("id").primaryKey(),
		virtualKeyId: uuid("virtual_key_id"),
		publicModel: text("public_model").notNull(),
		deploymentId: uuid("deployment_id"),
		adapterKey: text("adapter_key").notNull(),
		upstreamModel: text("upstream_model").notNull(),
		upstreamJobId: text("upstream_job_id").notNull(),
		upstreamGenerationId: text("upstream_generation_id"),
		upstreamPollingUrl: text("upstream_polling_url"),
		providerState: jsonb("provider_state")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		request: jsonb("request").$type<Record<string, unknown>>().notNull(),
		prompt: text("prompt").notNull(),
		seconds: text("seconds"),
		size: text("size"),
		quality: text("quality"),
		status: videoStatusEnum("status").notNull().default("queued"),
		progress: integer("progress").notNull().default(0),
		error: jsonb("error").$type<Record<string, unknown>>(),
		usage: jsonb("usage").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
		nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
	},
	(t) => [
		index("video_jobs_virtual_key_created_idx").on(t.virtualKeyId, t.createdAt),
		index("video_jobs_public_model_idx").on(t.publicModel),
		index("video_jobs_deployment_idx").on(t.deploymentId),
		index("video_jobs_status_poll_idx").on(t.status, t.nextPollAt),
		index("video_jobs_expires_at_idx").on(t.expiresAt),
		check(
			"video_jobs_adapter_key_format",
			sql`${t.adapterKey} ~ '^[a-z0-9]+$'`,
		),
		check(
			"video_jobs_progress_range",
			sql`${t.progress} >= 0 AND ${t.progress} <= 100`,
		),
	],
);

/* ------------------------------------------------------------- video_assets */

export const videoAssets = pgTable(
	"video_assets",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		videoId: text("video_id")
			.notNull()
			.references(() => videoJobs.id, { onDelete: "cascade" }),
		variant: videoAssetVariantEnum("variant").notNull(),
		objectKey: text("object_key").notNull(),
		storageBackend: text("storage_backend").notNull(),
		contentType: text("content_type").notNull(),
		contentLength: integer("content_length"),
		etag: text("etag"),
		sha256: text("sha256"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("video_assets_video_variant_idx").on(t.videoId, t.variant),
		index("video_assets_expires_at_idx").on(t.expiresAt),
		index("video_assets_deleted_at_idx").on(t.deletedAt),
	],
);

/* ------------------------------------------------------ extension_artifacts */

/**
 * Versioned, immutable extension code. The ESM module source uses a purpose-bound, key-versioned
 * AES-256-GCM envelope and is integrity-checked on every materialization via
 * `content_hash` (sha256 of the plaintext source). Exactly one row per `key` is `active`; uploading
 * a new version archives the previous one, and activating an older version performs a rollback.
 */
export const extensionArtifacts = pgTable(
	"extension_artifacts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		/** Definition key; must equal the `key` exported by the module. */
		key: text("key").notNull(),
		/** Monotonic per-key version, assigned on upload. */
		version: integer("version").notNull(),
		/** SHA-256 (hex) of the plaintext module source. */
		contentHash: text("content_hash").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		/** Purpose-bound, key-versioned AES-256-GCM module-source envelope. */
		code: jsonb("code").$type<EncEnvelope>().notNull(),
		status: extensionArtifactStatusEnum("status").notNull().default("active"),
		/** Auth principal that uploaded it (currently always the master key). */
		uploadedBy: text("uploaded_by"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("extension_artifacts_key_version_idx").on(t.key, t.version),
		index("extension_artifacts_key_status_idx").on(t.key, t.status),
		check("extension_artifacts_key_format", sql`${t.key} ~ '^[a-z0-9]+$'`),
	],
);

/* ------------------------------------------------------ extension_instances */

/**
 * Configuration that binds a definition (by `definition_key`) to a `match`, `config`, `priority`, and
 * failure policy.
 */
export const extensionInstances = pgTable(
	"extension_instances",
	{
		id: text("id").primaryKey(),
		definitionKey: text("definition_key").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		/** null = inherit the definition's defaultCritical. */
		critical: boolean("critical"),
		priority: integer("priority").notNull().default(0),
		match: jsonb("match")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		config: jsonb("config").$type<unknown>().notNull().default({}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("extension_instances_definition_key_idx").on(t.definitionKey),
		check(
			"extension_instances_definition_key_format",
			sql`${t.definitionKey} ~ '^[a-z0-9]+$'`,
		),
	],
);

/* ------------------------------------------------------- extension_registry */

/**
 * Singleton (id = 1) version counter, bumped on every extension mutation. Replicas poll it to detect
 * drift and hot-reload the runtime without a restart.
 */
export const extensionRegistry = pgTable(
	"extension_registry",
	{
		id: smallint("id").primaryKey().default(1),
		version: integer("version").notNull().default(0),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [check("extension_registry_id_singleton", sql`${t.id} = 1`)],
);
