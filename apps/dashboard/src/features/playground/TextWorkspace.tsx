"use client";

import { Select, SelectItem } from "#/components/ui/select";
import { NumberField } from "#/components/ui/number-field";
import { buttonStyles } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { ModelSelect } from "./ModelSelect";
import { ChatSession } from "./ChatSession";
import { Tabs } from "#/components/ui/tabs";

import {
	type PlaygroundModel,
	reasoningEffortsFor,
	type ModelChoice,
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

/**
 * Text generation: a conversation, under one of the three public chat contracts.
 *
 * The conversation survives a change of model or of transport — comparing two models on the same
 * thread is the point of a playground — but the parameters do not: they were chosen against the old
 * model's declared support, and one the new model rejects fails the whole request.
 */
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

export function TextWorkspace({
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
		if (lastTarget.current === target) {
			return;
		}
		lastTarget.current = target;
		setSettings(initialSettings(model, endpoint));
	}, [target, model, endpoint]);

	function setParameter(key: string, value: number | null) {
		setSettings((current) => {
			const parameters = { ...current.parameters };
			if (value === null && endpoint === "messages" && key === "max_tokens") {
				parameters[key] =
					initialSettings(model, endpoint).parameters.max_tokens ?? 1024;
			} else if (value === null) {
				delete parameters[key];
			} else {
				parameters[key] = value;
			}
			return { ...current, parameters };
		});
	}
	return (
		<div className="mx-auto flex min-h-0 w-full flex-1 flex-col">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<ChatSession
					endpoint={endpoint}
					key={generation}
					modalities={capabilities.inputModalities}
					modelId={model.id}
					modelPicker={
						<ModelSelect
							capability="text"
							modelId={model.id}
							models={models}
							onSelect={onSelect}
						/>
					}
					onReset={() => setGeneration((current) => current + 1)}
					onSettings={() => setSettingsOpen(true)}
					settings={settings}
				/>
			</div>
			<SettingsDialog
				efforts={efforts}
				endpoint={endpoint}
				model={model}
				onEndpoint={onEndpoint}
				onOpenChange={setSettingsOpen}
				open={settingsOpen}
				setParameter={setParameter}
				setSettings={setSettings}
				settings={settings}
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
		<DialogRoot onOpenChange={onOpenChange} open={open}>
			<DialogContent className="md:w-xl" layout="sectioned">
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
						description="The public contract this conversation is sent under. Only the ones this model exposes are offered."
						label="Transport"
						onValueChange={(value) => {
							if (isPublicEndpoint(value)) {
								onEndpoint(value);
							}
						}}
						value={endpoint}
					>
						{model.endpoints.map((key) => (
							<SelectItem key={key} value={key}>
								{PUBLIC_ENDPOINTS[key].label}
							</SelectItem>
						))}
					</Select>
					<Tabs.Root defaultValue="generation">
						<Tabs.List className="w-full">
							<Tabs.Tab className="flex-1" value="generation">
								Generation
							</Tabs.Tab>
							<Tabs.Tab className="flex-1" value="instructions">
								Instructions
							</Tabs.Tab>
							{hasAdvanced ? (
								<Tabs.Tab className="flex-1" value="advanced">
									Advanced
								</Tabs.Tab>
							) : null}
						</Tabs.List>
						<Tabs.Panel className="mt-4 space-y-5" value="generation">
							{efforts.length ? (
								<Select
									label="Reasoning effort"
									onValueChange={(value) =>
										setSettings((current) => {
											const next = { ...current };
											if (value === "default" || value === null) {
												delete next.reasoningEffort;
											} else {
												next.reasoningEffort = value;
											}
											return next;
										})
									}
									value={settings.reasoningEffort ?? "default"}
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
									max={control.max}
									min={control.min}
									onValueChange={(value) => setParameter(control.key, value)}
									required={
										endpoint === "messages" && control.key === "max_tokens"
									}
									step={control.step}
									value={settings.parameters[control.key] ?? null}
								>
									<NumberField.ScrubArea>
										<label
											className="font-medium text-sm"
											htmlFor={`playground-${control.key}`}
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
						<Tabs.Panel className="mt-4 space-y-5" value="instructions">
							<Textarea
								label="System prompt"
								onChange={(event) =>
									setSettings((current) => ({
										...current,
										systemPrompt: event.target.value,
									}))
								}
								placeholder="Optional instructions"
								rows={6}
								value={settings.systemPrompt}
							/>
						</Tabs.Panel>
						{hasAdvanced ? (
							<Tabs.Panel className="mt-4 space-y-5" value="advanced">
								{advancedControls.map((control) => {
									const values = parameterValues(model, control.key);
									return values.length ? (
										<Select
											key={control.key}
											label={control.label}
											onValueChange={(value) =>
												setParameter(
													control.key,
													value === "default" || value === null
														? null
														: Number(value),
												)
											}
											value={
												settings.parameters[control.key]?.toString() ??
												"default"
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
										onChange={(event) =>
											setSettings((current) => ({
												...current,
												stopSequences: event.target.value.split("\n"),
											}))
										}
										placeholder="One sequence per line"
										rows={3}
										value={settings.stopSequences.join("\n")}
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
