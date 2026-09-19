"use client";

import { Select, SelectItem } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import type { AdapterOperation } from "./common";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";
import { Input } from "#/components/ui/input";
import { useState } from "react";

import {
	operationTemplate,
	type CustomEntry,
	parseCustomEntry,
	updateProfile,
	objectValue,
} from "./custom-model";

export function CustomModelEditor({
	value,
	onChange,
	technical,
	onTechnicalChange,
	operations,
	transports,
	onTransportsChange,
}: {
	value: CustomEntry;
	onChange: (value: CustomEntry) => void;
	technical: string | null;
	onTechnicalChange: (value: string | null) => void;
	operations: AdapterOperation[];
	transports: Record<string, string>;
	onTransportsChange: (value: Record<string, string>) => void;
}) {
	const [error, setError] = useState<string | null>(null);
	function toggleTechnical() {
		setError(null);
		if (technical === null) {
			onTechnicalChange(JSON.stringify(value, null, 2));
			return;
		}
		try {
			onChange(parseCustomEntry(technical));
			onTechnicalChange(null);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Invalid custom configuration.",
			);
		}
	}
	return (
		<fieldset className="flex min-w-0 flex-col gap-4 rounded-xl border border-border/50 p-4">
			<legend className="px-1 font-medium text-fg text-sm">
				Custom model configuration
			</legend>
			<p className="text-fg-muted text-xs">
				This ID is not in the adapter catalog. Enable only the operations and
				capabilities your upstream supports. Suggested image and video values
				must match your provider.
			</p>
			<div>
				<Button onClick={toggleTechnical} size="sm" variant="secondary">
					{technical === null
						? "Technical configuration"
						: "Return to guided fields"}
				</Button>
			</div>
			{technical === null ? (
				<>
					{operations.map((operation) => {
						const profile = value.operations[operation.id];
						const setProfile = (patch: Record<string, unknown>) =>
							onChange(updateProfile(value, operation.id, patch));
						return (
							<div
								className="flex flex-col gap-4 border-border/50 border-t pt-4"
								key={operation.id}
							>
								<Switch
									checked={profile !== undefined}
									onCheckedChange={(checked) => {
										const next = { ...value.operations };
										if (checked) {
											next[operation.id] = operationTemplate(operation.id);
										} else {
											delete next[operation.id];
										}
										onChange({ ...value, operations: next });
									}}
								>
									{operation.label}
								</Switch>
								{profile === undefined ? null : (
									<>
										{operation.id === "text.generate" ? (
											<TextProfile onChange={setProfile} profile={profile} />
										) : (
											<OperationFields
												id={operation.id}
												onChange={setProfile}
												profile={profile}
											/>
										)}
									</>
								)}
							</div>
						);
					})}
					{Object.keys(value.operations).some(
						(id) => !operations.some((operation) => operation.id === id),
					) ? (
						<p className="text-sm text-warning" role="alert">
							This entry contains operations not offered by this adapter. Review
							them in Technical configuration.
						</p>
					) : null}
					{Object.keys(value.operations).length === 0 ? (
						<p className="text-danger text-sm" role="alert">
							Select at least one operation.
						</p>
					) : null}
				</>
			) : (
				<div className="space-y-2">
					<Textarea
						aria-invalid={error !== null}
						className="resize-y font-mono text-xs"
						description="Complete catalog entry: operations, capabilities, modalities, limits, parameters, reasoning, pricing and notes. The gateway validates the full schema and adapter compatibility before saving. Returning to guided fields preserves technical properties."
						label="Full custom configuration (JSON)"
						onValueChange={onTechnicalChange}
						rows={14}
						spellCheck={false}
						value={technical}
					/>
					{error ? (
						<p className="text-danger text-sm" role="alert">
							{error}
						</p>
					) : null}
				</div>
			)}
			<details className="min-w-0">
				<summary className="cursor-pointer font-medium text-fg text-sm">
					Transport settings
				</summary>
				<p className="pt-3 text-fg-muted text-xs">
					Use adapter defaults unless your upstream requires a specific
					protocol. Only custom models expose these controls.
				</p>
				<div className="flex flex-col gap-4 pt-4">
					{operations
						.filter(
							(operation) =>
								technical !== null ||
								value.operations[operation.id] !== undefined,
						)
						.map((operation) => {
							const current = transports[operation.id] ?? "";
							return (
								<Select
									key={operation.id}
									label={`${operation.label} transport`}
									onValueChange={(transport) => {
										const next = { ...transports };
										if (transport) {
											next[operation.id] = transport;
										} else {
											delete next[operation.id];
										}
										onTransportsChange(next);
									}}
									value={current}
								>
									<SelectItem value="">
										{operation.defaultTransport
											? `Adapter default (${operation.defaultTransport})`
											: "Adapter default"}
									</SelectItem>
									{operation.transports.map((transport) => (
										<SelectItem key={transport} value={transport}>
											{transport}
										</SelectItem>
									))}
									{current && !operation.transports.includes(current) ? (
										<SelectItem value={current}>
											{current} (stored; unavailable)
										</SelectItem>
									) : null}
								</Select>
							);
						})}
				</div>
			</details>
		</fieldset>
	);
}

function TextProfile({
	profile,
	onChange,
}: {
	profile: Record<string, unknown>;
	onChange: (patch: Record<string, unknown>) => void;
}) {
	const capabilities = objectValue(profile.capabilities);
	const reasoning = objectValue(profile.reasoning);
	const kind =
		capabilities.reasoning === true
			? String(reasoning.kind ?? "unconfigured")
			: "none";
	return (
		<>
			<div className="grid gap-3 sm:grid-cols-2">
				{(
					[
						["tools", "Tool calling"],
						["strictTools", "Strict tool schemas"],
						["vision", "Image input (vision)"],
						["structuredOutputs", "Structured outputs"],
					] as const
				).map(([key, label]) => (
					<Switch
						checked={capabilities[key] === true}
						key={key}
						onCheckedChange={(checked) =>
							onChange({ capabilities: { ...capabilities, [key]: checked } })
						}
					>
						{label}
					</Switch>
				))}
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				<ProfileNumber
					label="Maximum input tokens"
					onChange={onChange}
					profile={profile}
					property="maxInputTokens"
				/>
				<ProfileNumber
					label="Maximum output tokens"
					onChange={onChange}
					profile={profile}
					property="maxOutputTokens"
				/>
			</div>
			<Select
				description="Other protocols, budgets and custom effort mappings are available in Technical configuration."
				label="Reasoning"
				onValueChange={(next) => {
					if (!next || next === kind) {
						return;
					}
					onChange({
						capabilities: { ...capabilities, reasoning: next !== "none" },
						reasoning:
							next === "none"
								? undefined
								: {
										kind: next,
										levels:
											next === "fixed" ? ["high"] : ["low", "medium", "high"],
									},
					});
				}}
				value={kind}
			>
				<SelectItem value="none">No reasoning</SelectItem>
				<SelectItem value="openai_effort">OpenAI effort levels</SelectItem>
				<SelectItem value="fixed">Always on (fixed)</SelectItem>
				{["none", "openai_effort", "fixed"].includes(kind) ? null : (
					<SelectItem value={kind}>{kind} (technical configuration)</SelectItem>
				)}
			</Select>
			{kind === "none" ? null : (
				<ListInput
					description="Comma-separated: none, minimal, low, medium, high, xhigh, max. Use only levels the model supports."
					key={kind}
					label="Reasoning levels"
					onChange={(levels) =>
						onChange({ reasoning: { ...reasoning, levels } })
					}
					value={reasoning.levels}
				/>
			)}
		</>
	);
}

function ProfileNumber({
	label,
	property,
	profile,
	onChange,
}: {
	label: string;
	property: string;
	profile: Record<string, unknown>;
	onChange: (patch: Record<string, unknown>) => void;
}) {
	return (
		<Input
			label={label}
			min={1}
			onValueChange={(value) =>
				onChange({ [property]: value.trim() ? Number(value) : undefined })
			}
			step={1}
			type="number"
			value={
				typeof profile[property] === "number" ? String(profile[property]) : ""
			}
		/>
	);
}

function ListInput({
	label,
	description,
	value,
	onChange,
}: {
	label: string;
	description?: string;
	value: unknown;
	onChange: (value: string[]) => void;
}) {
	const serialized = Array.isArray(value) ? value.join(", ") : "";
	const [text, setText] = useState(serialized);
	return (
		<Input
			description={description}
			label={label}
			onValueChange={(next) => {
				setText(next);
				onChange(
					next
						.split(",")
						.map((part) => part.trim())
						.filter(Boolean),
				);
			}}
			value={text}
		/>
	);
}

function OperationFields({
	id,
	profile,
	onChange,
}: {
	id: string;
	profile: Record<string, unknown>;
	onChange: (patch: Record<string, unknown>) => void;
}) {
	if (id === "embedding.create") {
		return (
			<div className="grid gap-4 sm:grid-cols-2">
				<ProfileNumber
					label="Embedding dimensions"
					onChange={onChange}
					profile={profile}
					property="dimensions"
				/>
				<ProfileNumber
					label="Maximum inputs"
					onChange={onChange}
					profile={profile}
					property="maxInputs"
				/>
				<ProfileNumber
					label="Maximum input tokens"
					onChange={onChange}
					profile={profile}
					property="maxInputTokens"
				/>
			</div>
		);
	}
	if (id === "audio.transcribe") {
		return (
			<ListInput
				description="Comma-separated: json, text, srt, verbose_json, vtt."
				label="Transcription response formats"
				onChange={(responseFormats) => onChange({ responseFormats })}
				value={profile.responseFormats}
			/>
		);
	}
	if (id === "rerank") {
		return (
			<ProfileNumber
				label="Maximum documents"
				onChange={onChange}
				profile={profile}
				property="maxDocuments"
			/>
		);
	}
	if (
		id === "image.generate" ||
		id === "image.edit" ||
		id === "video.generate"
	) {
		return (
			<>
				<ListInput
					description="Comma-separated, for example 1024x1024. Existing provider mappings are preserved; edit mappings or arbitrary sizing in Technical configuration."
					label="Supported sizes"
					onChange={(sizes) => {
						const previous = objectValue(profile.sizes);
						onChange({
							sizes: Object.fromEntries(
								sizes.map((size) => [size, previous[size] ?? {}]),
							),
						});
					}}
					value={Object.keys(objectValue(profile.sizes))}
				/>
				{id === "video.generate" ? (
					<ListInput
						description="Comma-separated durations supported by the upstream."
						label="Durations (seconds)"
						onChange={(durations) => onChange({ durations })}
						value={profile.durations}
					/>
				) : (
					<ListInput
						description="Comma-separated: png, jpeg, webp."
						label="Image output formats"
						onChange={(outputFormats) => onChange({ outputFormats })}
						value={profile.outputFormats}
					/>
				)}
			</>
		);
	}
	return null;
}
