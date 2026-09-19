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
		if (!input.validity.badInput) {
			onChange(input.value === "" ? undefined : Number(input.value));
		}
	}
	return (
		<Input
			{...props}
			onChange={handleChange}
			ref={ref}
			type="number"
			value={draft}
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
		if (rate === undefined) {
			delete next[field];
		} else {
			next[field] = rate;
		}
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
			<div className="grid gap-3 sm:grid-cols-2" key={reset}>
				{PRICING_RATE_FIELDS.map((field) => (
					<NumberInput
						key={field}
						label={RATE_LABELS[field]}
						min={0}
						onChange={(rate) => updateRate(field, rate)}
						step="any"
						value={value?.[field]}
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
					onClick={() => {
						let threshold = 1;
						while (tiers.some((tier) => tier.aboveInputTokens === threshold)) {
							threshold++;
						}
						setTierIds([...tierIds, nextId.current++]);
						emit({
							...value,
							tiers: [...tiers, { aboveInputTokens: threshold }],
						});
					}}
					size="sm"
					variant="secondary"
				>
					Add tier
				</Button>
			</div>
			{tiers.map((tier, index) => (
				<fieldset
					className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4"
					key={tierIds[index]}
				>
					<legend className="px-1 font-medium text-fg text-sm">
						Context tier {index + 1}
					</legend>
					<NumberInput
						description="Positive whole number; each threshold must be unique."
						label="Above input tokens"
						min={1}
						onChange={(threshold) => {
							if (threshold !== undefined) {
								updateTier(index, { aboveInputTokens: threshold });
							}
						}}
						required
						step={1}
						validate={(threshold) =>
							tiers.some(
								(other, i) =>
									i !== index && other.aboveInputTokens === threshold,
							)
								? "Each threshold must be unique."
								: ""
						}
						value={tier.aboveInputTokens}
					/>
					<div className="grid gap-3 sm:grid-cols-2">
						{TIER_FIELDS.map((field) => (
							<NumberInput
								key={field}
								label={RATE_LABELS[field]}
								min={0}
								onChange={(rate) => {
									const next = { ...tier };
									if (rate === undefined) {
										delete next[field];
									} else {
										next[field] = rate;
									}
									emit({
										...value,
										tiers: tiers.map((existing, i) =>
											i === index ? next : existing,
										),
									});
								}}
								step="any"
								value={tier[field]}
							/>
						))}
					</div>
					<div>
						<Button
							aria-label={`Remove context tier ${index + 1}`}
							onClick={() => {
								setTierIds(tierIds.filter((_, i) => i !== index));
								const next = { ...value };
								const remaining = tiers.filter((_, i) => i !== index);
								if (remaining.length) {
									next.tiers = remaining;
								} else {
									delete next.tiers;
								}
								emit(next);
							}}
							size="sm"
							variant="ghost"
						>
							Remove tier
						</Button>
					</div>
				</fieldset>
			))}
			<Button
				onClick={() => {
					setReset(reset + 1);
					setTierIds([]);
					onChange(undefined);
				}}
				variant="ghost"
			>
				Clear pricing override
			</Button>
		</section>
	);
}
