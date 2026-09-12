"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";

import {
	type PricingRateField,
	PRICING_RATE_FIELDS,
	type PricingTier,
	type Pricing,
} from "./pricing";

const RATE_LABELS: Record<PricingRateField, string> = {
	inputCentsPerMTokens: "Input (cents / 1M tokens)",
	outputCentsPerMTokens: "Output (cents / 1M tokens)",
	cacheReadCentsPerMTokens: "Cache read (cents / 1M tokens)",
	cacheWriteCentsPerMTokens: "Cache write (cents / 1M tokens)",
	searchUnitCents: "Search unit (cents)",
};
const TIER_FIELDS = PRICING_RATE_FIELDS.filter(
	(field) => field !== "searchUnitCents",
);

function NumberInput({
	value,
	onChange,
	validate,
	...props
}: {
	value: number | undefined;
	onChange: (value: number | undefined) => void;
	validate?: (value: number) => string;
	label: string;
	description?: string;
	min?: number;
	step?: number | "any";
	required?: boolean;
}) {
	const [draft, setDraft] = useState(value === undefined ? "" : String(value));
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => {
		setDraft(value === undefined ? "" : String(value));
	}, [value]);
	useEffect(() => {
		ref.current?.setCustomValidity(
			draft ? (validate?.(Number(draft)) ?? "") : "",
		);
	}, [draft, validate]);
	function handleChange(event: ChangeEvent<HTMLInputElement>) {
		const input = event.currentTarget;
		setDraft(input.value);
		input.setCustomValidity(
			input.value ? (validate?.(Number(input.value)) ?? "") : "",
		);
		if (!input.validity.badInput)
			onChange(input.value === "" ? undefined : Number(input.value));
	}
	return (
		<Input
			{...props}
			ref={ref}
			type="number"
			value={draft}
			onChange={handleChange}
		/>
	);
}

export function PricingEditor({
	value,
	onChange,
}: {
	value: Pricing | undefined;
	onChange: (value: Pricing | undefined) => void;
}) {
	const tiers = value?.tiers ?? [];
	const [reset, setReset] = useState(0);
	const nextId = useRef(tiers.length);
	const [tierIds, setTierIds] = useState(() => tiers.map((_, index) => index));
	function emit(next: Pricing) {
		onChange(Object.keys(next).length === 0 ? undefined : next);
	}
	function updateRate(field: PricingRateField, rate: number | undefined) {
		const next = { ...value };
		if (rate === undefined) delete next[field];
		else next[field] = rate;
		emit(next);
	}
	function updateTier(index: number, patch: Partial<PricingTier>) {
		emit({
			...value,
			tiers: tiers.map((tier, i) =>
				i === index ? { ...tier, ...patch } : tier,
			),
		});
	}
	return (
		<section aria-label="Pricing override" className="space-y-4">
			<div>
				<h3 className="font-semibold text-fg">Pricing override</h3>
				<p className="text-fg-muted text-sm">
					USD cents: 100 cents = $1. Token rates are per million tokens. Zero
					means free. An override replaces all catalog rates; blank fields are
					unset, not inherited. Clear the override to use catalog pricing.
				</p>
			</div>
			<div key={reset} className="grid gap-3 sm:grid-cols-2">
				{PRICING_RATE_FIELDS.map((field) => (
					<NumberInput
						key={field}
						label={RATE_LABELS[field]}
						min={0}
						step="any"
						value={value?.[field]}
						onChange={(rate) => updateRate(field, rate)}
					/>
				))}
			</div>
			<div className="flex items-center justify-between gap-3">
				<div>
					<h4 className="font-medium text-fg text-sm">Context tiers</h4>
					<p className="text-fg-muted text-xs">
						Whole-request rates above an input-token threshold. Blank tier rates
						use the base override rate.
					</p>
				</div>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => {
						let threshold = 1;
						while (tiers.some((tier) => tier.aboveInputTokens === threshold))
							threshold++;
						setTierIds([...tierIds, nextId.current++]);
						emit({
							...value,
							tiers: [...tiers, { aboveInputTokens: threshold }],
						});
					}}
				>
					Add tier
				</Button>
			</div>
			{tiers.map((tier, index) => (
				<fieldset
					key={tierIds[index]}
					className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4"
				>
					<legend className="px-1 font-medium text-fg text-sm">
						Context tier {index + 1}
					</legend>
					<NumberInput
						label="Above input tokens"
						description="Positive whole number; each threshold must be unique."
						min={1}
						step={1}
						required
						value={tier.aboveInputTokens}
						validate={(threshold) =>
							tiers.some(
								(other, i) =>
									i !== index && other.aboveInputTokens === threshold,
							)
								? "Each threshold must be unique."
								: ""
						}
						onChange={(threshold) => {
							if (threshold !== undefined)
								updateTier(index, { aboveInputTokens: threshold });
						}}
					/>
					<div className="grid gap-3 sm:grid-cols-2">
						{TIER_FIELDS.map((field) => (
							<NumberInput
								key={field}
								label={RATE_LABELS[field]}
								min={0}
								step="any"
								value={tier[field]}
								onChange={(rate) => {
									const next = { ...tier };
									if (rate === undefined) delete next[field];
									else next[field] = rate;
									emit({
										...value,
										tiers: tiers.map((existing, i) =>
											i === index ? next : existing,
										),
									});
								}}
							/>
						))}
					</div>
					<div>
						<Button
							size="sm"
							variant="ghost"
							aria-label={`Remove context tier ${index + 1}`}
							onClick={() => {
								setTierIds(tierIds.filter((_, i) => i !== index));
								const next = { ...value };
								const remaining = tiers.filter((_, i) => i !== index);
								if (remaining.length) next.tiers = remaining;
								else delete next.tiers;
								emit(next);
							}}
						>
							Remove tier
						</Button>
					</div>
				</fieldset>
			))}
			<Button
				variant="ghost"
				onClick={() => {
					setReset(reset + 1);
					setTierIds([]);
					onChange(undefined);
				}}
			>
				Clear pricing override
			</Button>
		</section>
	);
}
