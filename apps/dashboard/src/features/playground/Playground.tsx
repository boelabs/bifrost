"use client";

import { EmptyState, PageHeader } from "#/components/ui/page";
import { Select, SelectItem } from "#/components/ui/select";
import { NumberField } from "#/components/ui/number-field";
import { buttonStyles } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import type { Capability } from "./capabilities";
import { ModelSelect } from "./ModelSelect";
import { ChatSession } from "./ChatSession";
import { Tabs } from "#/components/ui/tabs";

import {
	type PlaygroundModel,
	reasoningEffortsFor,
	type ModelChoice,
	capabilityGroups,
	capabilitiesFor,
	parameterValues,
	tunablesFor,
	supports,
	TUNABLE,
} from "./models";

import {
	DialogDescription,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogClose,
	DialogTitle,
	DialogBody,
	DialogRoot,
} from "#/components/ui/dialog";

import {
	type PlaygroundSettings,
	type PublicEndpoint,
	isPublicEndpoint,
	PUBLIC_ENDPOINTS,
	emptySettings,
} from "./api";

import {
	type SetStateAction,
	type Dispatch,
	useEffect,
	useState,
	useRef,
} from "react";

export function initialSettings(
	model: PlaygroundModel,
	endpoint: PublicEndpoint,
): PlaygroundSettings {
	const settings = emptySettings();
	if (endpoint === "messages") {
		const control = tunablesFor(model, endpoint).find(
			(entry) => entry.key === "max_tokens",
		);
		const values = parameterValues(model, "max_tokens");
		settings.parameters.max_tokens =
			values?.[0] ??
			control?.fallback ??
			Math.min(1024, model.maxOutputTokens ?? 1024);
	}
	return settings;
}

function ModelSession({
	model,
	models,
	endpoint,
	onSelect,
	onEndpoint,
}: {
	model: PlaygroundModel;
	models: PlaygroundModel[];
	endpoint: PublicEndpoint;
	onSelect: (choice: ModelChoice) => void;
	onEndpoint: (endpoint: PublicEndpoint) => void;
}) {
	const [settings, setSettings] = useState(() =>
		initialSettings(model, endpoint),
	);
	const [generation, setGeneration] = useState(0);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const capabilities = capabilitiesFor(model, endpoint);
	const efforts = reasoningEffortsFor(model, endpoint);
	const tunables = tunablesFor(model, endpoint);

	/**
	 * Switching model or transport keeps the conversation — comparing two models on the same thread is
	 * the point of a playground — but not the parameters: they were chosen against the old model's
	 * declared support, and sending one the new model rejects fails the whole request under an
	 * `unsupportedParameterStrategy` of `error`.
	 */
	const target = `${model.id}:${endpoint}`;
	const lastTarget = useRef(target);
	useEffect(() => {
		if (lastTarget.current === target) return;
		lastTarget.current = target;
		setSettings(initialSettings(model, endpoint));
	}, [target, model, endpoint]);

	function setParameter(key: string, value: number | null) {
		setSettings((current) => {
			const parameters = { ...current.parameters };
			if (value === null && endpoint === "messages" && key === "max_tokens")
				parameters[key] =
					initialSettings(model, endpoint).parameters.max_tokens ?? 1024;
			else if (value === null) delete parameters[key];
			else parameters[key] = value;
			return { ...current, parameters };
		});
	}
	return (
		<div className="mx-auto flex min-h-0 w-full flex-1 flex-col">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<ChatSession
					key={generation}
					endpoint={endpoint}
					modelId={model.id}
					modalities={capabilities.inputModalities}
					settings={settings}
					onSettings={() => setSettingsOpen(true)}
					onReset={() => setGeneration((current) => current + 1)}
					modelPicker={
						<ModelSelect
							models={models}
							capability="text"
							modelId={model.id}
							onSelect={onSelect}
						/>
					}
				/>
			</div>
			<SettingsDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				model={model}
				endpoint={endpoint}
				onEndpoint={onEndpoint}
				settings={settings}
				setSettings={setSettings}
				setParameter={setParameter}
				efforts={efforts}
				tunables={tunables}
			/>
		</div>
	);
}

function SettingsDialog({
	open,
	onOpenChange,
	model,
	endpoint,
	onEndpoint,
	settings,
	setSettings,
	setParameter,
	efforts,
	tunables,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	model: PlaygroundModel;
	endpoint: PublicEndpoint;
	onEndpoint: (endpoint: PublicEndpoint) => void;
	settings: PlaygroundSettings;
	setSettings: Dispatch<SetStateAction<PlaygroundSettings>>;
	setParameter: (key: string, value: number | null) => void;
	efforts: string[];
	tunables: ReturnType<typeof tunablesFor>;
}) {
	const advancedControls = TUNABLE.filter(
		(control) =>
			supports(model, control.key, endpoint) &&
			parameterValues(model, control.key).length > 0,
	);
	const hasStop = supports(model, "stop", endpoint);
	const hasAdvanced = advancedControls.length > 0 || hasStop;
	return (
		<DialogRoot open={open} onOpenChange={onOpenChange}>
			<DialogContent layout="sectioned" className="md:w-xl">
				<DialogHeader>
					<DialogTitle>Model settings</DialogTitle>
					<DialogDescription>
						Only settings supported by the selected model and transport are
						available.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{/**
					 * The transport lives here rather than beside the model: it is the public contract the
					 * request is sent under, chosen once per experiment, and it decides which of the
					 * settings below even exist. The model is the knob that changes often — that one is in
					 * the composer.
					 */}
					<Select
						label="Transport"
						description="The public contract this conversation is sent under. Only the ones this model exposes are offered."
						value={endpoint}
						onValueChange={(value) => {
							if (isPublicEndpoint(value)) onEndpoint(value);
						}}
					>
						{model.endpoints.map((key) => (
							<SelectItem key={key} value={key}>
								{PUBLIC_ENDPOINTS[key].label}
							</SelectItem>
						))}
					</Select>
					<Tabs.Root defaultValue="generation">
						<Tabs.List className="w-full">
							<Tabs.Tab value="generation" className="flex-1">
								Generation
							</Tabs.Tab>
							<Tabs.Tab value="instructions" className="flex-1">
								Instructions
							</Tabs.Tab>
							{hasAdvanced ? (
								<Tabs.Tab value="advanced" className="flex-1">
									Advanced
								</Tabs.Tab>
							) : null}
						</Tabs.List>
						<Tabs.Panel value="generation" className="mt-4 space-y-5">
							{efforts.length ? (
								<Select
									label="Reasoning effort"
									value={settings.reasoningEffort ?? "default"}
									onValueChange={(value) =>
										setSettings((current) => {
											const next = { ...current };
											if (value === "default" || value === null)
												delete next.reasoningEffort;
											else next.reasoningEffort = value;
											return next;
										})
									}
								>
									<SelectItem value="default">Default</SelectItem>
									{efforts.map((effort) => (
										<SelectItem key={effort} value={effort}>
											{effort}
										</SelectItem>
									))}
								</Select>
							) : null}
							{tunables.map((control) => (
								<NumberField.Root
									key={control.key}
									value={settings.parameters[control.key] ?? null}
									onValueChange={(value) => setParameter(control.key, value)}
									min={control.min}
									max={control.max}
									step={control.step}
									required={
										endpoint === "messages" && control.key === "max_tokens"
									}
								>
									<NumberField.ScrubArea>
										<label
											htmlFor={`playground-${control.key}`}
											className="text-sm font-medium"
										>
											{control.label}
										</label>
									</NumberField.ScrubArea>
									<NumberField.Group>
										<NumberField.Decrement
											aria-label={`Decrease ${control.label}`}
										/>
										<NumberField.Input
											id={`playground-${control.key}`}
											placeholder={
												endpoint === "messages" && control.key === "max_tokens"
													? String(control.fallback)
													: "Default"
											}
										/>
										<NumberField.Increment
											aria-label={`Increase ${control.label}`}
										/>
									</NumberField.Group>
									<p className="text-fg-muted text-xs">
										{control.min.toLocaleString()} -{" "}
										{control.max.toLocaleString()}
									</p>
								</NumberField.Root>
							))}
						</Tabs.Panel>
						<Tabs.Panel value="instructions" className="mt-4 space-y-5">
							<Textarea
								label="System prompt"
								value={settings.systemPrompt}
								onChange={(event) =>
									setSettings((current) => ({
										...current,
										systemPrompt: event.target.value,
									}))
								}
								rows={6}
								placeholder="Optional instructions"
							/>
						</Tabs.Panel>
						{hasAdvanced ? (
							<Tabs.Panel value="advanced" className="mt-4 space-y-5">
								{advancedControls.map((control) => {
									const values = parameterValues(model, control.key);
									return values.length ? (
										<Select
											key={control.key}
											label={control.label}
											value={
												settings.parameters[control.key]?.toString() ??
												"default"
											}
											onValueChange={(value) =>
												setParameter(
													control.key,
													value === "default" || value === null
														? null
														: Number(value),
												)
											}
										>
											<SelectItem value="default">Default</SelectItem>
											{values.map((value) => (
												<SelectItem key={value} value={String(value)}>
													{value}
												</SelectItem>
											))}
										</Select>
									) : null;
								})}
								{hasStop ? (
									<Textarea
										label="Stop sequences"
										value={settings.stopSequences.join("\n")}
										onChange={(event) =>
											setSettings((current) => ({
												...current,
												stopSequences: event.target.value.split("\n"),
											}))
										}
										rows={3}
										placeholder="One sequence per line"
									/>
								) : null}
							</Tabs.Panel>
						) : null}
					</Tabs.Root>
				</DialogBody>
				<DialogFooter>
					<DialogClose
						className={buttonStyles({ variant: "primary", size: "sm" })}
					>
						Done
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</DialogRoot>
	);
}

/**
 * The session the operator is in: one model, under one of the things it can do.
 *
 * Both halves matter. A model that generates text and images is two different experiments, and the
 * capability is what says which one this is — so switching it replaces the workspace, while
 * switching the model within a capability keeps the work in progress.
 */
export interface PlaygroundSelection {
	capability: Capability;
	modelId: string;
}

export function initialSelection(
	models: PlaygroundModel[],
): PlaygroundSelection | undefined {
	const [group] = capabilityGroups(models);
	const [first] = group?.items ?? [];
	return first
		? { capability: first.capability, modelId: first.model.id }
		: undefined;
}

export function Playground({ models }: { models: PlaygroundModel[] }) {
	const [selection, setSelection] = useState(() => initialSelection(models));
	const selected = models.find((model) => model.id === selection?.modelId);
	const [endpoint, setEndpoint] = useState<PublicEndpoint>(
		selected?.endpoints[0] ?? "chat.completions",
	);
	/**
	 * A model reached through the picker decides the transport when it does not speak the current
	 * one. The alternative — hiding it until the transport is changed first — makes the operator
	 * guess which of the three contracts a name is behind.
	 */
	function select(choice: ModelChoice) {
		setSelection({ capability: choice.capability, modelId: choice.model.id });
		if (
			choice.capability === "text" &&
			!choice.model.endpoints.includes(endpoint)
		) {
			const [first] = choice.model.endpoints;
			if (first) setEndpoint(first);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<PageHeader
				title="Playground"
				description="Try your models. Conversations stay in this session."
			/>
			{selected && selection ? (
				<ModelSession
					// The workspace belongs to the capability: moving to another one starts its own.
					key={selection.capability}
					model={selected}
					models={models}
					endpoint={
						selected.endpoints.includes(endpoint)
							? endpoint
							: (selected.endpoints[0] ?? endpoint)
					}
					onSelect={select}
					onEndpoint={setEndpoint}
				/>
			) : (
				<EmptyState
					title="No models available"
					description="A model appears here when an enabled deployment exposes an operation this playground can run, through a compatible contract."
				/>
			)}
		</div>
	);
}
