"use client";

import { FormSkeleton } from "#/shared/components/Skeleton";
import { Select, SelectItem } from "#/components/ui/select";
import { useSession } from "#/features/auth/session.tsx";
import { saveRouterSettingsAction } from "./actions.ts";
import { Input } from "#/components/ui/input";

import {
	type RouterNumericKey,
	ROUTER_NUMERIC_FIELDS,
	PARAMETER_STRATEGIES,
	type RouterSettings,
	ROUTING_STRATEGIES,
	type RouterGroup,
	ERROR_CLASSES,
	readNumbers,
} from "./common.ts";

import {
	SettingsCardSkeleton,
	type SettingsCopy,
	SettingsCard,
	SettingRow,
} from "./SettingsCard.tsx";

/** The gateway stores a share; an operator reads a percentage. */
const toPercent = (share: number) => Math.round(share * 1000) / 10;
const toShare = (percent: number) => percent / 100;

/** Until the router settings are first written the gateway runs on its own defaults. */
const NEVER_SAVED =
	"Never saved: the gateway runs on its defaults until you save.";

const ROUTING: SettingsCopy = {
	title: "Routing",
	description:
		"How a request picks one deployment out of a public model's pool, and what happens to parameters the model does not support.",
	note: "Applies to every public model.",
};

const QUARANTINE: SettingsCopy = {
	title: "Taking a deployment out",
	description:
		"A deployment is quarantined on its failure rate, not on a raw count: an absolute threshold punishes a busy deployment for the same error rate a quiet one survives.",
	note: "Applies to every deployment.",
};

const BUDGETS: SettingsCopy = {
	title: "Budget per error class",
	description:
		"A timeout and a 502 are both transient, and an upstream you know well rarely deserves the same tolerance for each. Leave a box empty to inherit Allowed fails.",
	note: "Applies to every deployment.",
};

const COOLDOWN: SettingsCopy = {
	title: "Cooldown",
	description:
		"How long a deployment stays out. The cooldown escalates on each failed recovery probe, up to the ceiling; a successful probe clears it at once.",
	note: "Applies to every deployment.",
};

const fieldsIn = (group: RouterGroup) =>
	ROUTER_NUMERIC_FIELDS.filter((field) => field.group === group);

const keysIn = (group: RouterGroup): RouterNumericKey[] =>
	fieldsIn(group).map((field) => field.key);

function NumberField({
	field,
	settings,
	editable,
}: {
	field: (typeof ROUTER_NUMERIC_FIELDS)[number];
	settings: RouterSettings | null;
	editable: boolean;
}) {
	return (
		<Input
			defaultValue={String(settings?.[field.key] ?? "")}
			description={field.hint}
			disabled={!editable}
			label={field.unit ? `${field.label} (${field.unit})` : field.label}
			min={field.min}
			name={field.key}
			type="number"
			{...(field.step === undefined ? {} : { step: field.step })}
		/>
	);
}

interface FieldsProps {
	settings: RouterSettings | null;
	editable: boolean;
}

function RoutingFields({ settings, editable }: FieldsProps) {
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			<Select
				defaultValue={settings?.routingStrategy ?? "simple-shuffle"}
				description="How a request picks one deployment out of the pool."
				disabled={!editable}
				label="Routing strategy"
				name="routingStrategy"
			>
				{ROUTING_STRATEGIES.map((value) => (
					<SelectItem key={value} value={value}>
						{value}
					</SelectItem>
				))}
			</Select>
			<Select
				defaultValue={settings?.unsupportedParameterStrategy ?? "drop"}
				description="What happens when a request sends a parameter the target model does not support."
				disabled={!editable}
				label="Unsupported parameters"
				name="unsupportedParameterStrategy"
			>
				{PARAMETER_STRATEGIES.map((value) => (
					<SelectItem key={value} value={value}>
						{value}
					</SelectItem>
				))}
			</Select>
		</div>
	);
}

function QuarantineFields({ settings, editable }: FieldsProps) {
	return (
		<>
			<div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
				<Input
					defaultValue={String(toPercent(settings?.failureRatePercent ?? 0.5))}
					description="Share of the window's attempts that must fail. 50 means half of them."
					disabled={!editable}
					label="Failure rate (%)"
					max={100}
					min={1}
					name="failureRatePercent"
					type="number"
				/>
				{fieldsIn("opening").map((field) => (
					<NumberField
						editable={editable}
						field={field}
						key={field.key}
						settings={settings}
					/>
				))}
			</div>
			<SettingRow
				defaultChecked={settings?.protectLastDeployment ?? true}
				description="When a public model has nowhere else to route, count the failure but keep serving. A 503 from this gateway is less useful to the caller than the upstream's own error."
				disabled={!editable}
				label="Never quarantine the last deployment"
				name="protectLastDeployment"
			/>
		</>
	);
}

function BudgetFields({ settings, editable }: FieldsProps) {
	const ceiling = settings?.allowedFails ?? 3;
	const budgets: Partial<Record<string, number>> =
		settings?.allowedFailsByClass ?? {};
	return (
		<div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
			{ERROR_CLASSES.map((cls) => (
				<Input
					defaultValue={budgets[cls] === undefined ? "" : String(budgets[cls])}
					disabled={!editable}
					key={cls}
					label={cls}
					min={0}
					name={`class:${cls}`}
					placeholder={String(ceiling)}
					type="number"
				/>
			))}
		</div>
	);
}

function CooldownFields({ settings, editable }: FieldsProps) {
	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{fieldsIn("cooldown").map((field) => (
				<NumberField
					editable={editable}
					field={field}
					key={field.key}
					settings={settings}
				/>
			))}
		</div>
	);
}

/**
 * The router's scalars, one card per group an operator reasons about together.
 *
 * The gateway's PUT is a partial update, so each card writes only its own fields and a change in
 * one card never sends what another card holds. An empty number box is left out of the write: the
 * gateway keeps what it has, rather than reading the empty box as zero.
 */
export function RoutingSettings({
	settings,
}: {
	settings: RouterSettings | null;
}) {
	const { can } = useSession();
	const editable = can("settings:write");
	const props = { settings, editable };
	return (
		<>
			<SettingsCard
				copy={settings ? ROUTING : { ...ROUTING, note: NEVER_SAVED }}
				editable={editable}
				onSave={(form) => {
					const strategy = form.get("routingStrategy");
					const parameters = form.get("unsupportedParameterStrategy");
					const routingStrategy = ROUTING_STRATEGIES.find(
						(value) => value === strategy,
					);
					const unsupportedParameterStrategy = PARAMETER_STRATEGIES.find(
						(value) => value === parameters,
					);
					return saveRouterSettingsAction({
						...(routingStrategy ? { routingStrategy } : {}),
						...(unsupportedParameterStrategy
							? { unsupportedParameterStrategy }
							: {}),
					});
				}}
				success="Routing saved"
			>
				<RoutingFields {...props} />
			</SettingsCard>

			<SettingsCard
				copy={QUARANTINE}
				editable={editable}
				flush
				onSave={(form) => {
					const { failureRatePercent, ...opening } = readNumbers(form, [
						"failureRatePercent",
						...keysIn("opening"),
					]);
					return saveRouterSettingsAction({
						...opening,
						...(failureRatePercent === undefined
							? {}
							: { failureRatePercent: toShare(failureRatePercent) }),
						protectLastDeployment: form.has("protectLastDeployment"),
					});
				}}
				success="Quarantine rules saved"
			>
				<QuarantineFields {...props} />
			</SettingsCard>

			<SettingsCard
				copy={BUDGETS}
				editable={editable}
				onSave={(form) => {
					// An empty box means "inherit the ceiling", which is the ABSENCE of a key rather than
					// a zero: zero would mean "open on the first failure of this class", the opposite.
					const budgets = readNumbers(
						form,
						ERROR_CLASSES.map((cls) => `class:${cls}` as const),
					);
					const allowedFailsByClass: Record<string, number> = {};
					for (const cls of ERROR_CLASSES) {
						const budget = budgets[`class:${cls}`];
						if (budget !== undefined) {
							allowedFailsByClass[cls] = budget;
						}
					}
					return saveRouterSettingsAction({ allowedFailsByClass });
				}}
				success="Error budgets saved"
			>
				<BudgetFields {...props} />
			</SettingsCard>

			<SettingsCard
				copy={COOLDOWN}
				editable={editable}
				onSave={(form) =>
					saveRouterSettingsAction(readNumbers(form, keysIn("cooldown")))
				}
				success="Cooldown saved"
			>
				<CooldownFields {...props} />
			</SettingsCard>
		</>
	);
}

const SKELETON_PROPS: FieldsProps = { settings: null, editable: true };

export function RoutingSettingsSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading routing settings"
			className="flex flex-col gap-6"
			role="status"
		>
			<SettingsCardSkeleton copy={ROUTING}>
				<FormSkeleton>
					<RoutingFields {...SKELETON_PROPS} />
				</FormSkeleton>
			</SettingsCardSkeleton>
			<SettingsCardSkeleton copy={QUARANTINE} flush>
				<FormSkeleton>
					<QuarantineFields {...SKELETON_PROPS} />
				</FormSkeleton>
			</SettingsCardSkeleton>
			<SettingsCardSkeleton copy={BUDGETS}>
				<FormSkeleton>
					<BudgetFields {...SKELETON_PROPS} />
				</FormSkeleton>
			</SettingsCardSkeleton>
			<SettingsCardSkeleton copy={COOLDOWN}>
				<FormSkeleton>
					<CooldownFields {...SKELETON_PROPS} />
				</FormSkeleton>
			</SettingsCardSkeleton>
		</div>
	);
}
