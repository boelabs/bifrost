import { getRegistryVersion } from "#db/repos/extensions.ts";
import type { CallType } from "#core/callType.ts";
import { GatewayError } from "#core/errors.ts";
import { pathToFileURL } from "node:url";
import { log } from "#logging/log.ts";
import { env } from "#config/env.ts";
import { resolve } from "node:path";
import * as z from "zod/v4";

import type {
	ExtensionCanonicalResponse,
	ExtensionCanonicalRequest,
	ExtensionInstanceContext,
	ExtensionImageOutput,
	ExtensionStreamEvent,
	ExtensionDefinition,
	ExtensionPublicAuth,
	ExtensionHookName,
	ExtensionLogger,
	MaybePromise,
} from "./sdk.ts";

import {
	DbExtensionInstanceSource,
	EXTENSIONS_CACHE_DIR,
	pruneExtensionCache,
} from "./source.ts";

const EXTENSION_KEY_PATTERN = /^[a-z0-9]+$/;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

interface ManifestModuleSpec {
	path: string;
}

interface ManifestInstanceSpec {
	id: string;
	definition: string;
	enabled?: boolean | undefined;
	priority?: number | undefined;
	critical?: boolean | undefined;
	match?: Record<string, unknown> | undefined;
	config?: unknown;
}

interface ExtensionManifest {
	modules: ManifestModuleSpec[];
	instances: ManifestInstanceSpec[];
}

export interface ExtensionInstanceSource {
	load(): Promise<ExtensionManifest>;
}

interface LoadedDefinition {
	definition: ExtensionDefinition;
	modulePath: string;
	order: number;
	setupDone: boolean;
}

type InstanceStatus = "active" | "configured_disabled" | "runtime_disabled";

/** What disabled an instance, so the admin reset endpoint only revives circuit-breaker trips. */
type DisabledKind = "config" | "load" | "setup" | "breaker";

interface LoadedInstance {
	id: string;
	definitionKey: string;
	definition?: ExtensionDefinition;
	enabled: boolean;
	critical: boolean;
	priority: number;
	order: number;
	config: unknown;
	match: Record<string, unknown>;
	status: InstanceStatus;
	failureCount: number;
	lastError: ExtensionErrorView | null;
	disabledReason: string | null;
	disabledKind: DisabledKind | null;
}

interface ExtensionErrorView {
	message: string;
	hook?: ExtensionHookName | "setup" | "load";
	at: string;
}

export interface ExtensionScope {
	requestId: string;
	callType: CallType;
	endpoint: string;
	publicModel: string | null;
	auth: ExtensionPublicAuth;
	signal: AbortSignal;
}

const moduleSpecSchema = z
	.object({
		path: z.string().min(1),
	})
	.strict();

const instanceSpecSchema = z
	.object({
		id: z.string().regex(INSTANCE_ID_PATTERN),
		definition: z.string().regex(EXTENSION_KEY_PATTERN),
		enabled: z.boolean().optional(),
		priority: z.int().optional(),
		critical: z.boolean().optional(),
		match: z.record(z.string(), z.unknown()).optional(),
		config: z.unknown().optional(),
	})
	.strict();

const manifestSchema = z
	.object({
		modules: z.array(moduleSpecSchema),
		instances: z.array(instanceSpecSchema),
	})
	.strict();

const builtinMatchSchema = z
	.object({
		models: z.array(z.string().min(1)).optional(),
		callTypes: z.array(z.string().min(1)).optional(),
		endpoints: z.array(z.string().min(1)).optional(),
	})
	.loose();

function nowIso(): string {
	return new Date().toISOString();
}

/** Normalizes an AbortSignal's reason to an Error for throwing. */
function abortReason(signal: AbortSignal): Error {
	const reason: unknown = signal.reason;
	if (reason instanceof Error) return reason;
	return new Error(
		typeof reason === "string" ? reason : "extension hook aborted",
	);
}

/**
 * Runs an extension hook with a wall-clock budget and request-cancellation guard. The hook receives a
 * signal that aborts on timeout or upstream cancellation, and the awaited result loses a race against
 * that abort so a hook that ignores its signal can never block request processing indefinitely.
 */
async function withHookGuard<R>(
	requestSignal: AbortSignal,
	run: (signal: AbortSignal) => MaybePromise<R>,
): Promise<R> {
	const timeoutMs = env.BIFROST_EXTENSION_HOOK_TIMEOUT_MS;
	const timeoutController = new AbortController();
	const combined = AbortSignal.any([requestSignal, timeoutController.signal]);
	if (combined.aborted) throw abortReason(combined);

	const timer =
		timeoutMs > 0
			? setTimeout(
					() =>
						timeoutController.abort(
							new Error(`extension hook timed out after ${timeoutMs}ms`),
						),
					timeoutMs,
				)
			: null;
	timer?.unref?.();

	const runPromise = (async () => run(combined))();
	// If the hook keeps running after we lose the race, swallow its late rejection.
	runPromise.catch(() => {});
	let rejectAbort: (error: Error) => void = () => {};
	const onAbort = () => rejectAbort(abortReason(combined));
	const abortPromise = new Promise<never>((_, reject) => {
		rejectAbort = reject;
		combined.addEventListener("abort", onAbort, { once: true });
		// Abort can happen between the initial check above and listener registration.
		if (combined.aborted) onAbort();
	});

	try {
		return await Promise.race([runPromise, abortPromise]);
	} finally {
		combined.removeEventListener("abort", onAbort);
		if (timer) clearTimeout(timer);
	}
}

function errorView(
	err: unknown,
	hook?: ExtensionHookName | "setup" | "load",
): ExtensionErrorView {
	return {
		message: err instanceof Error ? err.message : String(err),
		...(hook ? { hook } : {}),
		at: nowIso(),
	};
}

function schemaErrorMessage(error: unknown): string {
	if (error && typeof error === "object" && "issues" in error) {
		const issues = (error as { issues?: unknown }).issues;
		if (Array.isArray(issues)) {
			return issues
				.map((issue) => {
					if (!issue || typeof issue !== "object") return String(issue);
					const path = Array.isArray((issue as { path?: unknown }).path)
						? ((issue as { path: unknown[] }).path.join(".") ?? "")
						: "";
					const message =
						typeof (issue as { message?: unknown }).message === "string"
							? (issue as { message: string }).message
							: String(issue);
					return path ? `${path}: ${message}` : message;
				})
				.join("; ");
		}
	}
	return error instanceof Error ? error.message : String(error);
}

function parseWithSchema<T>(
	schema: {
		safeParse(
			value: unknown,
		): { success: true; data: T } | { success: false; error: unknown };
	},
	value: unknown,
	label: string,
): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success)
		throw new Error(`${label}: ${schemaErrorMessage(parsed.error)}`);
	return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isDefinition(value: unknown): value is ExtensionDefinition {
	return (
		isRecord(value) &&
		typeof value.key === "string" &&
		EXTENSION_KEY_PATTERN.test(value.key) &&
		isRecord(value.hooks)
	);
}

function resolveExport(namespace: Record<string, unknown>): unknown {
	return namespace.default ?? namespace.extension;
}

function matchApplies(
	match: Record<string, unknown>,
	scope: ExtensionScope,
): boolean {
	const models = match.models;
	if (Array.isArray(models)) {
		if (!scope.publicModel || !models.includes(scope.publicModel)) return false;
	}
	const callTypes = match.callTypes;
	if (Array.isArray(callTypes) && !callTypes.includes(scope.callType))
		return false;
	const endpoints = match.endpoints;
	if (Array.isArray(endpoints) && !endpoints.includes(scope.endpoint))
		return false;
	return true;
}

function hookError(
	instance: LoadedInstance,
	hook: ExtensionHookName,
	err: unknown,
): GatewayError {
	return new GatewayError({
		class: "server",
		message: `Extension "${instance.definitionKey}" instance "${instance.id}" failed in ${hook}: ${err instanceof Error ? err.message : String(err)}`,
		publicMessage: "A Bifrost extension failed while processing the request.",
		code: "extension_hook_failed",
		failureKind: "gateway",
		deploymentHealth: "neutral",
		routingScope: "request",
		cause: err,
	});
}

function disabledError(instance: LoadedInstance): GatewayError {
	return new GatewayError({
		class: "server",
		status: 503,
		message: `Required extension "${instance.definitionKey}" instance "${instance.id}" is disabled: ${instance.disabledReason ?? "unknown reason"}`,
		publicMessage: "A required Bifrost extension is disabled.",
		code: "extension_disabled",
		failureKind: "gateway",
		deploymentHealth: "neutral",
		routingScope: "request",
	});
}

function makeLogger(
	extensionKey: string,
	instanceId?: string,
): ExtensionLogger {
	const fields = instanceId ? { extensionKey, instanceId } : { extensionKey };
	return {
		debug: (message, extra) =>
			log.debug("extensions", message, { ...fields, ...(extra ?? {}) }),
		info: (message, extra) =>
			log.info("extensions", message, { ...fields, ...(extra ?? {}) }),
		warn: (message, extra) =>
			log.warn("extensions", message, { ...fields, ...(extra ?? {}) }),
		error: (message, extra) =>
			log.error("extensions", message, { ...fields, ...(extra ?? {}) }),
	};
}

function validateImageOutput(value: unknown): ExtensionImageOutput {
	if (!isRecord(value)) throw new Error("onImageOutput must return an object");
	const data = value.data;
	if (!(data instanceof Uint8Array))
		throw new Error("onImageOutput.data must be a Uint8Array");
	const mimeType = value.mimeType;
	if (
		mimeType !== "image/png" &&
		mimeType !== "image/jpeg" &&
		mimeType !== "image/webp"
	) {
		throw new Error(
			"onImageOutput.mimeType must be image/png, image/jpeg, or image/webp",
		);
	}
	const format = value.format;
	if (format !== "png" && format !== "jpeg" && format !== "webp")
		throw new Error("onImageOutput.format must be png, jpeg, or webp");
	if (`image/${format}` !== mimeType)
		throw new Error(
			`onImageOutput.mimeType "${mimeType}" does not match format "${format}"`,
		);
	const { width, height } = value;
	if (!isPositiveInteger(width) || !isPositiveInteger(height))
		throw new Error("onImageOutput.width and height must be positive integers");
	return { data, mimeType, format, width, height };
}

class ExtensionRuntime {
	private definitions = new Map<string, LoadedDefinition>();
	private instances: LoadedInstance[] = [];
	private loaded = false;
	private loadedRegistryVersion = 0;

	/** Loads the current database state and records the registry version it corresponds to. */
	async loadFromDb(): Promise<void> {
		const version = await getRegistryVersion();
		await this.buildAndSwap(new DbExtensionInstanceSource());
		this.loadedRegistryVersion = version;
	}

	/**
	 * Re-reads the database only when the registry version changed since the last load. Cheap to call
	 * on a polling interval: a single `SELECT version`, then a full reload on drift.
	 */
	async reloadIfChanged(): Promise<boolean> {
		const version = await getRegistryVersion();
		if (version === this.loadedRegistryVersion) return false;
		await this.buildAndSwap(new DbExtensionInstanceSource());
		this.loadedRegistryVersion = version;
		log.info("extensions", "reloaded after registry change", { version });
		return true;
	}

	/** Forces an immediate reload (used right after an admin mutation in this process). */
	async reloadNow(): Promise<void> {
		const version = await getRegistryVersion();
		await this.buildAndSwap(new DbExtensionInstanceSource());
		this.loadedRegistryVersion = version;
	}

	/**
	 * Builds the full next state (definitions + instances + setup) and swaps it in atomically only on
	 * success — a failure leaves the running state untouched. Definitions that were removed or replaced
	 * by a different code version are torn down afterwards so reloads do not leak resources.
	 */
	private async buildAndSwap(source: ExtensionInstanceSource): Promise<void> {
		const previous = this.definitions;
		await this.loadFromSource(source, EXTENSIONS_CACHE_DIR);
		await this.teardownReplaced(previous);
		const activePaths = new Set(
			[...this.definitions.values()].map((definition) => definition.modulePath),
		);
		const removed = await pruneExtensionCache(activePaths);
		if (removed > 0)
			log.info("extensions", "pruned inactive materialized modules", {
				removed,
			});
	}

	private async teardownReplaced(
		previous: Map<string, LoadedDefinition>,
	): Promise<void> {
		for (const old of previous.values()) {
			if (!old.setupDone || !old.definition.teardown) continue;
			// modulePath is content-addressed, so an identical key+path means the same code is still
			// loaded and must keep its setup state.
			const current = this.definitions.get(old.definition.key);
			if (current && current.modulePath === old.modulePath) continue;
			try {
				await old.definition.teardown({
					extensionKey: old.definition.key,
					log: makeLogger(old.definition.key),
				});
			} catch (err) {
				log.warn("extensions", "extension teardown failed", {
					extensionKey: old.definition.key,
					err,
				});
			}
		}
	}

	async loadFromSource(
		source: ExtensionInstanceSource,
		baseDir: string,
	): Promise<void> {
		const manifest = parseWithSchema(
			manifestSchema,
			await source.load(),
			"extensions manifest",
		);
		const definitions = new Map<string, LoadedDefinition>();

		// A bad module is skipped, never fatal: instances that reference its (now-missing) definition
		// are disabled below. Loading must not crash the process over one broken artifact.
		for (const [order, moduleSpec] of manifest.modules.entries()) {
			const modulePath = resolve(baseDir, moduleSpec.path);
			let namespace: Record<string, unknown>;
			try {
				namespace = (await import(pathToFileURL(modulePath).href)) as Record<
					string,
					unknown
				>;
			} catch (err) {
				log.error(
					"extensions",
					"skipped extension module that failed to import",
					{
						module: moduleSpec.path,
						err,
					},
				);
				continue;
			}
			const definition = resolveExport(namespace);
			if (!isDefinition(definition)) {
				log.error(
					"extensions",
					"skipped extension module with invalid export",
					{ module: moduleSpec.path },
				);
				continue;
			}
			if (definitions.has(definition.key)) {
				log.error("extensions", "skipped duplicate extension definition", {
					module: moduleSpec.path,
					extensionKey: definition.key,
				});
				continue;
			}
			definitions.set(definition.key, {
				definition,
				modulePath,
				order,
				setupDone: false,
			});
		}

		const instances = this.buildInstances(manifest.instances, definitions);
		await this.setupDefinitions(definitions, instances);

		this.definitions = definitions;
		this.instances = instances.sort(
			(a, b) => a.priority - b.priority || a.order - b.order,
		);
		this.loaded = true;
		log.info("extensions", "loaded extensions", {
			definitions: definitions.size,
			instances: instances.length,
		});
	}

	private buildInstances(
		specs: ManifestInstanceSpec[],
		definitions: Map<string, LoadedDefinition>,
	): LoadedInstance[] {
		const seen = new Set<string>();
		const instances: LoadedInstance[] = [];
		for (const [order, spec] of specs.entries()) {
			// Duplicate ids can only come from a corrupt source (the DB enforces a PK); skip the dupe
			// rather than abort the whole load.
			if (seen.has(spec.id)) {
				log.error("extensions", "skipped duplicate extension instance id", {
					instanceId: spec.id,
				});
				continue;
			}
			seen.add(spec.id);

			const loadedDefinition = definitions.get(spec.definition);
			const critical =
				spec.critical ?? loadedDefinition?.definition.defaultCritical ?? true;
			const base: LoadedInstance = {
				id: spec.id,
				definitionKey: spec.definition,
				...(loadedDefinition
					? { definition: loadedDefinition.definition }
					: {}),
				enabled: spec.enabled ?? true,
				critical,
				priority: spec.priority ?? 0,
				order,
				config: spec.config ?? {},
				match: spec.match ?? {},
				status: spec.enabled === false ? "configured_disabled" : "active",
				failureCount: 0,
				lastError: null,
				disabledReason: spec.enabled === false ? "configured disabled" : null,
				disabledKind: spec.enabled === false ? "config" : null,
			};

			const error = this.validateInstance(base, loadedDefinition);
			if (error) {
				// Never fatal: a misconfigured instance is disabled and surfaced in status. A disabled
				// CRITICAL instance makes status unhealthy and fails its matched requests closed
				// (extension_disabled), but the gateway still boots so the admin API stays reachable to
				// fix it (e.g. upload the missing definition), after which a reload re-activates it.
				base.status = "runtime_disabled";
				base.disabledReason = error.message;
				base.disabledKind = "load";
				base.lastError = errorView(error, "load");
				const fields = {
					instanceId: base.id,
					extensionKey: base.definitionKey,
					critical,
					err: error,
				};
				if (critical)
					log.error(
						"extensions",
						"disabled invalid critical extension instance; gateway is unhealthy until fixed",
						fields,
					);
				else
					log.warn(
						"extensions",
						"disabled invalid non-critical extension instance",
						fields,
					);
			}
			instances.push(base);
		}
		return instances;
	}

	private validateInstance(
		instance: LoadedInstance,
		loadedDefinition: LoadedDefinition | undefined,
	): Error | null {
		if (!loadedDefinition)
			return new Error(
				`Extension instance "${instance.id}" references unknown definition "${instance.definitionKey}"`,
			);
		try {
			instance.match = parseWithSchema(
				builtinMatchSchema,
				instance.match,
				`extension instance "${instance.id}" match`,
			);
			const definition = loadedDefinition.definition;
			if (definition.matchSchema) {
				instance.match = parseWithSchema(
					definition.matchSchema,
					instance.match,
					`extension instance "${instance.id}" match`,
				) as Record<string, unknown>;
			}
			if (definition.configSchema) {
				instance.config = parseWithSchema(
					definition.configSchema,
					instance.config,
					`extension instance "${instance.id}" config`,
				);
			}
		} catch (err) {
			return err instanceof Error ? err : new Error(String(err));
		}
		return null;
	}

	private async setupDefinitions(
		definitions: Map<string, LoadedDefinition>,
		instances: LoadedInstance[],
	): Promise<void> {
		for (const loaded of definitions.values()) {
			const activeInstances = instances.filter(
				(instance) =>
					instance.definitionKey === loaded.definition.key &&
					instance.enabled &&
					instance.status === "active",
			);
			if (activeInstances.length === 0 || !loaded.definition.setup) continue;
			try {
				await loaded.definition.setup({
					extensionKey: loaded.definition.key,
					log: makeLogger(loaded.definition.key),
				});
				loaded.setupDone = true;
			} catch (err) {
				// Setup failure disables the affected instances but never crashes the load: a critical
				// one makes status unhealthy (and fails its requests closed) while the process stays up.
				const critical = activeInstances.some((instance) => instance.critical);
				for (const instance of activeInstances) {
					instance.status = "runtime_disabled";
					instance.disabledReason = `setup failed: ${schemaErrorMessage(err)}`;
					instance.disabledKind = "setup";
					instance.lastError = errorView(err, "setup");
				}
				const fields = { extensionKey: loaded.definition.key, critical, err };
				if (critical)
					log.error(
						"extensions",
						"disabled critical extension after setup failure; gateway is unhealthy until fixed",
						fields,
					);
				else
					log.warn(
						"extensions",
						"disabled non-critical extension after setup failure",
						fields,
					);
			}
		}
	}

	private contextFor(
		scope: ExtensionScope,
		instance: LoadedInstance,
	): ExtensionInstanceContext {
		return {
			...scope,
			extensionKey: instance.definitionKey,
			instanceId: instance.id,
			critical: instance.critical,
			config: instance.config,
			match: instance.match,
			log: makeLogger(instance.definitionKey, instance.id),
		};
	}

	private instancesFor(
		hook: ExtensionHookName,
		scope: ExtensionScope,
	): LoadedInstance[] {
		const selected: LoadedInstance[] = [];
		for (const instance of this.instances) {
			if (!instance.enabled || !matchApplies(instance.match, scope)) continue;
			const hasHook = instance.definition?.hooks[hook] !== undefined;
			if (instance.status !== "active") {
				if (instance.critical) throw disabledError(instance);
				continue;
			}
			if (hasHook) selected.push(instance);
		}
		return selected;
	}

	private recordSuccess(instance: LoadedInstance): void {
		instance.failureCount = 0;
	}

	private recordFailure(
		instance: LoadedInstance,
		hook: ExtensionHookName,
		err: unknown,
	): void {
		instance.failureCount += 1;
		instance.lastError = errorView(err, hook);
		log.error("extensions", "extension hook failed", {
			extensionKey: instance.definitionKey,
			instanceId: instance.id,
			hook,
			failures: instance.failureCount,
			err,
		});
		if (instance.failureCount >= env.BIFROST_EXTENSION_MAX_FAILURES) {
			instance.status = "runtime_disabled";
			instance.disabledKind = "breaker";
			instance.disabledReason = `${hook} failed ${instance.failureCount} consecutive time(s)`;
			log.error("extensions", "disabled extension instance", {
				extensionKey: instance.definitionKey,
				instanceId: instance.id,
				critical: instance.critical,
				reason: instance.disabledReason,
			});
		}
	}

	async runCanonicalRequest<T extends ExtensionCanonicalRequest>(
		scope: ExtensionScope,
		request: T,
	): Promise<T> {
		let current: ExtensionCanonicalRequest = request;
		for (const instance of this.instancesFor("onCanonicalRequest", scope)) {
			const hookScope = { ...scope, publicModel: current.model };
			try {
				const out = await withHookGuard(scope.signal, (signal) =>
					instance.definition!.hooks.onCanonicalRequest!(
						this.contextFor({ ...hookScope, signal }, instance),
						current,
					),
				);
				if (out !== undefined) {
					if (!isRecord(out))
						throw new Error("onCanonicalRequest must return an object");
					current = out;
				}
				this.recordSuccess(instance);
			} catch (err) {
				this.recordFailure(instance, "onCanonicalRequest", err);
				throw hookError(instance, "onCanonicalRequest", err);
			}
		}
		return current as T;
	}

	async runCanonicalResponse<T extends ExtensionCanonicalResponse>(
		scope: ExtensionScope,
		response: T,
	): Promise<T> {
		let current: ExtensionCanonicalResponse = response;
		for (const instance of this.instancesFor("onCanonicalResponse", scope)) {
			try {
				const out = await withHookGuard(scope.signal, (signal) =>
					instance.definition!.hooks.onCanonicalResponse!(
						this.contextFor({ ...scope, signal }, instance),
						current,
					),
				);
				if (out !== undefined) {
					if (!isRecord(out))
						throw new Error("onCanonicalResponse must return an object");
					current = out;
				}
				this.recordSuccess(instance);
			} catch (err) {
				this.recordFailure(instance, "onCanonicalResponse", err);
				throw hookError(instance, "onCanonicalResponse", err);
			}
		}
		return current as T;
	}

	async runStreamEvent<T extends ExtensionStreamEvent>(
		scope: ExtensionScope,
		event: T,
	): Promise<T> {
		let current: ExtensionStreamEvent = event;
		for (const instance of this.instancesFor("onStreamEvent", scope)) {
			try {
				const out = await withHookGuard(scope.signal, (signal) =>
					instance.definition!.hooks.onStreamEvent!(
						this.contextFor({ ...scope, signal }, instance),
						current,
					),
				);
				if (out !== undefined) {
					if (!isRecord(out))
						throw new Error("onStreamEvent must return an object");
					current = out;
				}
				this.recordSuccess(instance);
			} catch (err) {
				this.recordFailure(instance, "onStreamEvent", err);
				throw hookError(instance, "onStreamEvent", err);
			}
		}
		return current as T;
	}

	async runImageOutput(
		scope: ExtensionScope,
		output: ExtensionImageOutput,
	): Promise<ExtensionImageOutput> {
		let current = output;
		for (const instance of this.instancesFor("onImageOutput", scope)) {
			try {
				const out = await withHookGuard(scope.signal, (signal) =>
					instance.definition!.hooks.onImageOutput!(
						this.contextFor({ ...scope, signal }, instance),
						current,
					),
				);
				if (out instanceof Uint8Array) current = { ...current, data: out };
				else if (out !== undefined) current = validateImageOutput(out);
				this.recordSuccess(instance);
			} catch (err) {
				this.recordFailure(instance, "onImageOutput", err);
				throw hookError(instance, "onImageOutput", err);
			}
		}
		return current;
	}

	async runErrorHooks(scope: ExtensionScope, error: unknown): Promise<void> {
		for (const instance of this.instancesFor("onError", scope)) {
			try {
				await withHookGuard(scope.signal, (signal) =>
					instance.definition!.hooks.onError!(
						this.contextFor({ ...scope, signal }, instance),
						error,
					),
				);
			} catch (err) {
				// onError is a fire-and-forget observability hook: a failure here is recorded for
				// visibility but must never trip the circuit breaker, since that could disable a
				// critical instance (and fail unrelated requests) over a logging glitch.
				instance.lastError = errorView(err, "onError");
				log.error("extensions", "extension error hook failed", {
					extensionKey: instance.definitionKey,
					instanceId: instance.id,
					err,
				});
			}
		}
	}

	status() {
		const instances = this.instances.map((instance) => ({
			id: instance.id,
			definition: instance.definitionKey,
			enabled: instance.enabled,
			status: instance.status,
			critical: instance.critical,
			priority: instance.priority,
			failureCount: instance.failureCount,
			disabledReason: instance.disabledReason,
			lastError: instance.lastError,
			hooks: instance.definition
				? (Object.keys(instance.definition.hooks) as ExtensionHookName[])
				: [],
		}));
		const hasCriticalDisabled = instances.some(
			(instance) =>
				instance.enabled &&
				instance.critical &&
				instance.status === "runtime_disabled",
		);
		const hasDisabled = instances.some(
			(instance) => instance.enabled && instance.status === "runtime_disabled",
		);
		return {
			loaded: this.loaded,
			status: hasCriticalDisabled ? "error" : hasDisabled ? "degraded" : "ok",
			healthy: !hasCriticalDisabled,
			definitions: [...this.definitions.values()].map((loaded) => ({
				key: loaded.definition.key,
				version: loaded.definition.version ?? null,
				label: loaded.definition.label ?? loaded.definition.key,
				description: loaded.definition.description ?? null,
				modulePath: loaded.modulePath,
				setupDone: loaded.setupDone,
				hooks: Object.keys(loaded.definition.hooks) as ExtensionHookName[],
			})),
			instances,
		};
	}

	/**
	 * Clears a circuit-breaker trip and re-activates the instance without restarting the process.
	 * Only instances disabled by repeated runtime failures are eligible; ones disabled by config,
	 * load-time validation, or setup are left untouched because their underlying problem persists.
	 */
	resetInstance(id: string): {
		found: boolean;
		reset: boolean;
		reason?: string;
	} {
		const instance = this.instances.find((candidate) => candidate.id === id);
		if (!instance) return { found: false, reset: false };
		if (
			instance.status !== "runtime_disabled" ||
			instance.disabledKind === null
		)
			return { found: true, reset: false, reason: "instance is not disabled" };
		if (instance.disabledKind !== "breaker") {
			return {
				found: true,
				reset: false,
				reason: `instance was disabled at ${instance.disabledKind} time and cannot be reset at runtime`,
			};
		}
		instance.status = "active";
		instance.failureCount = 0;
		instance.disabledReason = null;
		instance.disabledKind = null;
		instance.lastError = null;
		log.info("extensions", "reset extension instance", {
			extensionKey: instance.definitionKey,
			instanceId: instance.id,
		});
		return { found: true, reset: true };
	}
}

export const extensionRuntime = new ExtensionRuntime();

export async function initializeExtensions(): Promise<void> {
	await extensionRuntime.loadFromDb();
}

/** Applies a mutation's effect in this process immediately; other replicas pick it up via the job. */
export async function reloadExtensions(): Promise<void> {
	await extensionRuntime.reloadNow();
}

/**
 * Polls the registry version and hot-reloads on drift, mirroring the other in-app jobs. This is how an
 * admin mutation on one replica propagates to the rest without a restart. Returns a stop function.
 */
export function startExtensionReloadJob(): () => void {
	const run = (): void => {
		void extensionRuntime.reloadIfChanged().catch((err: unknown) => {
			log.error("extensions", "reload poll failed", { err });
		});
	};
	const timer = setInterval(run, env.BIFROST_EXTENSIONS_RELOAD_INTERVAL_MS);
	timer.unref();
	return () => clearInterval(timer);
}

export function extensionStatus() {
	return extensionRuntime.status();
}

export function resetExtensionInstance(id: string) {
	return extensionRuntime.resetInstance(id);
}
