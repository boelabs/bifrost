"use client";

import { Input } from "#/components/ui/input";

import {
	type ExecutionPolicies as Policies,
	EXECUTION_CALL_TYPES,
	type ExecutionPolicy,
} from "./common.ts";

const MODES = [
	{ key: "json", label: "JSON" },
	{ key: "stream", label: "Stream" },
] as const;

const FIELDS = [
	{ key: "responseMs", label: "Response", unit: "seconds" },
	{ key: "idleMs", label: "Idle", unit: "seconds" },
	{ key: "totalMs", label: "Total", unit: "seconds" },
	{ key: "maxAttempts", label: "Attempts", unit: null },
] as const;

const fieldName = (callType: string, mode: string, field: string) =>
	`policy:${callType}:${mode}:${field}`;

/** The policy as the form shows it: seconds instead of milliseconds, an empty box for "no limit". */
function displayValue(policy: ExecutionPolicy | undefined, field: string) {
	const value = policy?.[field as keyof ExecutionPolicy];
	if (value === null || value === undefined) {
		return "";
	}
	return field === "maxAttempts" ? String(value) : String(value / 1000);
}

/** Reads the editor's boxes back into the shape the gateway stores. */
export function readExecutionPolicies(form: FormData): Policies {
	const read = (callType: string, mode: string): ExecutionPolicy => {
		const number = (field: string) => {
			const raw = form.get(fieldName(callType, mode, field));
			return typeof raw === "string" && raw.trim() !== "" ? Number(raw) : null;
		};
		const ms = (field: string) => {
			const value = number(field);
			return value === null ? null : Math.round(value * 1000);
		};
		return {
			responseMs: ms("responseMs") ?? 0,
			// Idleness only exists between stream bytes; a JSON answer arrives whole.
			idleMs: mode === "stream" ? ms("idleMs") : null,
			totalMs: ms("totalMs") ?? 0,
			maxAttempts: number("maxAttempts") ?? 1,
		};
	};
	return Object.fromEntries(
		EXECUTION_CALL_TYPES.map(({ key }) => [
			key,
			{ json: read(key, "json"), stream: read(key, "stream") },
		]),
	) as Policies;
}

/**
 * How long the gateway waits on an upstream, per call type and mode. The deadlines watch the
 * connection, never the model's output: a model that reasons silently for minutes is still
 * working, and only a connection that stops moving is cut.
 */
export function ExecutionPoliciesEditor({
	policies,
	editable,
}: {
	/** As the gateway reports them: keyed by call type, any of which may be missing. */
	policies:
		| Partial<
				Record<string, { json: ExecutionPolicy; stream: ExecutionPolicy }>
		  >
		| undefined;
	editable: boolean;
}) {
	return (
		<div className="flex flex-col gap-5">
			{EXECUTION_CALL_TYPES.map(({ key, label }) => (
				<div className="flex flex-col gap-2" key={key}>
					<h4 className="font-medium text-fg text-xs">{label}</h4>
					<div className="grid grid-cols-[2.75rem_repeat(4,minmax(0,1fr))] items-center gap-x-1.5 gap-y-1.5 sm:grid-cols-[3.5rem_repeat(4,minmax(0,1fr))] sm:gap-x-2">
						<span />
						{FIELDS.map((field) => (
							<span
								className="truncate text-fg-muted text-xs"
								key={field.key}
								title={field.label}
							>
								{field.label}
							</span>
						))}
						{MODES.map((mode) => (
							<div className="contents" key={mode.key}>
								<span className="text-fg-muted text-xs">{mode.label}</span>
								{FIELDS.map((field) => {
									const inapplicable =
										field.key === "idleMs" && mode.key === "json";
									return (
										<Input
											aria-label={`${label}, ${mode.label}: ${field.label}${field.unit ? ` (${field.unit})` : ""}`}
											defaultValue={
												inapplicable
													? ""
													: displayValue(policies?.[key]?.[mode.key], field.key)
											}
											disabled={!editable || inapplicable}
											key={field.key}
											min={1}
											name={fieldName(key, mode.key, field.key)}
											placeholder={
												inapplicable || field.key === "idleMs" ? "—" : undefined
											}
											required={!(inapplicable || field.key === "idleMs")}
											size="sm"
											step={field.unit ? 0.1 : 1}
											type="number"
										/>
									);
								})}
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
