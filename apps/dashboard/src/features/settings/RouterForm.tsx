"use client";

import { Select, SelectItem } from "#/components/ui/select";
import { saveRouterSettingsAction } from "./actions.ts";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";
import { Input } from "#/components/ui/input";
import { Form } from "#/components/ui/form";
import { useState } from "react";

import {
	type RouterNumericKey,
	ROUTER_NUMERIC_FIELDS,
	PARAMETER_STRATEGIES,
	type RouterSettings,
	ROUTING_STRATEGIES,
	type RouterGroup,
	ROUTER_GROUPS,
	ERROR_CLASSES,
} from "./common.ts";

/** The gateway stores a share; an operator reads a percentage. */
const toPercent = (share: number) => Math.round(share * 1000) / 10;
const toShare = (percent: number) => percent / 100;

function Section({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-5 border-border/50 border-t pt-6">
			<div>
				<h3 className="font-medium text-fg text-sm">{title}</h3>
				<p className="max-w-3xl pt-1 text-fg-muted text-xs">{description}</p>
			</div>
			{children}
		</section>
	);
}

/** The Switch primitive takes its label as children and has no description slot of its own. */
function Toggle({
	label,
	description,
	checked,
	onChange,
	disabled,
}: {
	label: string;
	description: string;
	checked: boolean;
	onChange: (next: boolean) => void;
	disabled: boolean;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Switch checked={checked} onCheckedChange={onChange} disabled={disabled}>
				{label}
			</Switch>
			<p className="max-w-3xl text-fg-muted text-xs">{description}</p>
		</div>
	);
}

/**
 * Every scalar the router exposes, edited together and saved in one PUT.
 *
 * Saving field by field on change looked tidier but is wrong here: these settings constrain each
 * other (a cooldown above its ceiling, a window shorter than a probe), so a half-applied set is a
 * configuration the operator never asked for. One explicit save keeps the gateway's validation
 * judging the whole thing at once.
 */
export function RouterForm({
	settings,
	editable,
	onSaved,
}: {
	settings: RouterSettings | null;
	editable: boolean;
	onSaved: () => Promise<void> | void;
}) {
	const [strategy, setStrategy] = useState(
		settings?.routingStrategy ?? "simple-shuffle",
	);
	const [parameters, setParameters] = useState(
		settings?.unsupportedParameterStrategy ?? "drop",
	);
	const [protectLast, setProtectLast] = useState(
		settings?.protectLastDeployment ?? true,
	);
	const [adaptive, setAdaptive] = useState(
		settings?.adaptiveTimeoutsEnabled ?? true,
	);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [saved, setSaved] = useState(false);

	const inheritedBudget = settings?.allowedFails ?? 3;
	const budgets: Partial<Record<string, number>> =
		settings?.allowedFailsByClass ?? {};

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setSaved(false);
		setPending(true);
		const form = new FormData(event.currentTarget);
		const numbers = Object.fromEntries(
			ROUTER_NUMERIC_FIELDS.map((field) => [
				field.key,
				Number(form.get(field.key)),
			]),
		) as Record<RouterNumericKey, number>;

		// An empty box means "inherit the ceiling", which is the ABSENCE of a key rather than a zero:
		// zero would mean "open on the first failure of this class", which is the opposite.
		const allowedFailsByClass: Record<string, number> = {};
		for (const cls of ERROR_CLASSES) {
			const raw = form.get(`class:${cls}`);
			if (typeof raw === "string" && raw.trim() !== "")
				allowedFailsByClass[cls] = Number(raw);
		}

		try {
			const result = await saveRouterSettingsAction({
				routingStrategy: strategy as never,
				unsupportedParameterStrategy: parameters as never,
				protectLastDeployment: protectLast,
				adaptiveTimeoutsEnabled: adaptive,
				failureRatePercent: toShare(Number(form.get("failureRatePercent"))),
				allowedFailsByClass: allowedFailsByClass as never,
				...numbers,
			});
			if (!result.ok) {
				setError(result.message);
				return;
			}
			await onSaved();
			setSaved(true);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not save the settings.",
			);
		} finally {
			setPending(false);
		}
	}

	const fieldsIn = (group: RouterGroup) =>
		ROUTER_NUMERIC_FIELDS.filter((field) => field.group === group);

	const numberBox = (field: (typeof ROUTER_NUMERIC_FIELDS)[number]) => (
		<Input
			key={field.key}
			name={field.key}
			type="number"
			min={field.min}
			{...(field.step === undefined ? {} : { step: field.step })}
			label={field.unit ? `${field.label} (${field.unit})` : field.label}
			description={field.hint}
			disabled={!editable || (field.group === "deadlines" && !adaptive)}
			defaultValue={String(settings?.[field.key] ?? "")}
		/>
	);

	return (
		<Form onSubmit={onSubmit} className="flex flex-col gap-6">
			<div className="grid gap-6 sm:grid-cols-2">
				<Select
					label="Routing strategy"
					description="How a request picks one deployment out of a public model's pool."
					disabled={!editable}
					value={strategy}
					onValueChange={(key) => setStrategy(String(key) as never)}
				>
					{ROUTING_STRATEGIES.map((value) => (
						<SelectItem key={value} value={value}>
							{value}
						</SelectItem>
					))}
				</Select>

				<Select
					label="Unsupported parameters"
					description="What happens when a request sends a parameter the target model does not support."
					disabled={!editable}
					value={parameters}
					onValueChange={(key) => setParameters(String(key) as never)}
				>
					{PARAMETER_STRATEGIES.map((value) => (
						<SelectItem key={value} value={value}>
							{value}
						</SelectItem>
					))}
				</Select>
			</div>

			<Section {...ROUTER_GROUPS[0]!}>
				<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
					<Input
						name="failureRatePercent"
						type="number"
						min={1}
						max={100}
						label="Failure rate (%)"
						description="Share of the window's attempts that must fail. 50 means half of them."
						disabled={!editable}
						defaultValue={String(
							toPercent(settings?.failureRatePercent ?? 0.5),
						)}
					/>
					{fieldsIn("opening").map(numberBox)}
				</div>
				<Toggle
					label="Never quarantine the last deployment"
					description="When a public model has nowhere else to route, count the failure but keep serving. A 503 from this gateway is less useful to the caller than the upstream's own error."
					checked={protectLast}
					onChange={setProtectLast}
					disabled={!editable}
				/>
			</Section>

			<Section {...ROUTER_GROUPS[1]!}>
				<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
					{fieldsIn("cooldown").map(numberBox)}
				</div>
			</Section>

			<Section {...ROUTER_GROUPS[2]!}>
				<Toggle
					label="Adapt deadlines to each deployment"
					description="Use each deployment's measured first-output time instead of the pool-wide budget."
					checked={adaptive}
					onChange={setAdaptive}
					disabled={!editable}
				/>
				<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
					{fieldsIn("deadlines").map(numberBox)}
				</div>
			</Section>

			<Section
				title="Budget per error class"
				description={`Leave a box empty to inherit the ceiling above (${inheritedBudget}). A timeout and a 502 are both transient, and an upstream you know well rarely deserves the same tolerance for each.`}
			>
				<div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
					{ERROR_CLASSES.map((cls) => (
						<Input
							key={cls}
							name={`class:${cls}`}
							type="number"
							min={0}
							label={cls}
							placeholder={String(inheritedBudget)}
							disabled={!editable}
							defaultValue={
								budgets[cls] === undefined ? "" : String(budgets[cls])
							}
						/>
					))}
				</div>
			</Section>

			{error ? <ErrorNote>{error}</ErrorNote> : null}

			{editable ? (
				<div className="flex items-center justify-end gap-3">
					{saved ? <span className="text-fg-muted text-sm">Saved.</span> : null}
					<Button type="submit" disabled={pending}>
						{pending ? "Saving…" : "Save router settings"}
					</Button>
				</div>
			) : null}
		</Form>
	);
}
