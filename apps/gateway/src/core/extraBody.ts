import { GatewayError } from "./errors.ts";

export function assertNoManagedExtraBodyKeys(
	extraBody: Record<string, unknown> | undefined,
	managedKeys: Iterable<string>,
	param = "extra_body",
): void {
	if (extraBody === undefined) return;
	const managed = new Set(managedKeys);
	for (const key of Object.keys(extraBody)) {
		if (!managed.has(key)) continue;
		throw new GatewayError({
			class: "bad_request",
			message: `${param}.${key} collides with managed request parameter "${key}"`,
			code: "invalid_extra_body",
			param: `${param}.${key}`,
		});
	}
}

export function mergeExtraBody<T extends Record<string, unknown>>(
	body: T,
	extraBody: Record<string, unknown> | undefined,
	managedKeys: Iterable<string>,
	param = "extra_body",
): T {
	assertNoManagedExtraBodyKeys(extraBody, managedKeys, param);
	if (extraBody === undefined) return body;
	return { ...body, ...extraBody };
}

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function validateJsonValue(value: unknown, path: string, depth: number): void {
	if (depth > 12) {
		throw new GatewayError({
			class: "bad_request",
			message: `${path} exceeds the maximum nesting depth`,
			code: "invalid_extra_body",
			param: path,
		});
	}
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return;
	if (typeof value === "number" && Number.isFinite(value)) return;
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			validateJsonValue(item, `${path}.${index}`, depth + 1);
		}
		return;
	}
	if (!isPlainObject(value)) {
		throw new GatewayError({
			class: "bad_request",
			message: `${path} must contain JSON values only`,
			code: "invalid_extra_body",
			param: path,
		});
	}
	for (const [key, child] of Object.entries(value)) {
		const childPath = `${path}.${key}`;
		if (DANGEROUS_KEYS.has(key)) {
			throw new GatewayError({
				class: "bad_request",
				message: `${childPath} is not allowed`,
				code: "invalid_extra_body",
				param: childPath,
			});
		}
		validateJsonValue(child, childPath, depth + 1);
	}
}

/**
 * Merges provider-specific extras without letting them overwrite managed leaves. Intermediate objects
 * can be shared: e.g. `generationConfig.safetySettings` alongside the adapter-generated
 * `generationConfig.responseModalities`.
 */
export function mergeExtraBodyDeep<T extends Record<string, unknown>>(
	body: T,
	extraBody: Record<string, unknown> | undefined,
	managedPaths: Iterable<string> = [],
	param = "extra_body",
): T {
	if (extraBody === undefined) return body;
	validateJsonValue(extraBody, param, 0);
	const encoded = JSON.stringify(extraBody);
	if (Buffer.byteLength(encoded, "utf8") > 65_536) {
		throw new GatewayError({
			class: "bad_request",
			message: `${param} exceeds the 64 KiB limit`,
			code: "invalid_extra_body",
			param,
		});
	}

	const managed = new Set(managedPaths);
	const merge = (
		target: Record<string, unknown>,
		source: Record<string, unknown>,
		path: string,
	): void => {
		for (const [key, value] of Object.entries(source)) {
			const relative = path ? `${path}.${key}` : key;
			const full = `${param}.${relative}`;
			if (managed.has(relative)) {
				throw new GatewayError({
					class: "bad_request",
					message: `${full} collides with managed request parameter "${relative}"`,
					code: "invalid_extra_body",
					param: full,
				});
			}
			const current = target[key];
			if (current !== undefined) {
				if (isPlainObject(current) && isPlainObject(value)) {
					merge(current, value, relative);
					continue;
				}
				throw new GatewayError({
					class: "bad_request",
					message: `${full} collides with a generated upstream field`,
					code: "invalid_extra_body",
					param: full,
				});
			}
			target[key] = structuredClone(value);
		}
	};

	const result = structuredClone(body);
	merge(result, extraBody, "");
	return result;
}
