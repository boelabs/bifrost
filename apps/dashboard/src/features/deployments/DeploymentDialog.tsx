"use client";

import { useIdempotencyKey } from "#/shared/lib/useIdempotencyKey.ts";
import { ModelInput } from "#/shared/components/ModelPicker.tsx";
import { ChevronDown as IconChevronDown } from "lucide-react";
import { SearchableSelect } from "#/components/ui/select";
import { Collapsible } from "#/components/ui/collapsible";
import { CustomModelEditor } from "./CustomModelEditor";
import { parsePricing, type Pricing } from "./pricing";
import { Textarea } from "#/components/ui/textarea";
import { saveDeploymentAction } from "./actions.ts";
import { useMemo, useRef, useState } from "react";
import { ErrorNote } from "#/components/ui/page";
import { PricingEditor } from "./PricingEditor";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import { Switch } from "#/components/ui/switch";
import { Input } from "#/components/ui/input";
import { Form } from "#/components/ui/form";

import {
	type CreateDeploymentInput,
	isKnownUpstreamModel,
	type AdapterSummary,
	type Deployment,
} from "./common.ts";

import {
	initialCustomEntry,
	selectedTransports,
	parseCustomEntry,
	parseObject,
} from "./custom-model";

import {
	DialogHeader,
	DialogFooter,
	DialogBody,
	Dialog,
	Modal,
} from "#/components/ui/modal";

function submitLabelFor(pending: boolean, editing: boolean): string {
	if (pending) {
		return "Saving…";
	}
	return editing ? "Save changes" : "Create deployment";
}

function optionalText(raw: FormDataEntryValue | null): string | undefined {
	const text = String(raw ?? "").trim();
	return text ? text : undefined;
}

function optionalNumber(raw: FormDataEntryValue | null): number | undefined {
	const text = String(raw ?? "").trim();
	return text ? Number(text) : undefined;
}

const CREDENTIAL_LABELS: Record<string, string> = {
	apiKey: "API key",
	baseUrl: "Base URL",
};

export function DeploymentDialog({
	isOpen,
	onClose,
	onSaved,
	adapters,
	existing,
}: {
	isOpen: boolean;
	onClose: () => void;
	onSaved: () => Promise<void> | void;
	adapters: AdapterSummary[];
	/** Present when editing; the adapter of an existing deployment cannot change. */
	existing?: Deployment;
}) {
	const editing = existing !== undefined;
	const [adapterKey, setAdapterKey] = useState(existing?.adapterKey ?? "");
	const [upstreamModel, setUpstreamModel] = useState(
		existing?.upstreamModel ?? "",
	);
	const [customEntry, setCustomEntry] = useState(
		() =>
			existing?.catalogEntry ??
			initialCustomEntry(
				(
					adapters.find((entry) => entry.id === adapterKey)?.operations ?? []
				).map((operation) => operation.id),
			),
	);
	const [technical, setTechnical] = useState<string | null>(null);
	const [transports, setTransports] = useState(
		existing?.transportOverrides ?? {},
	);
	const [pricing, setPricing] = useState<Pricing | undefined>(
		existing?.pricing ?? undefined,
	);
	const [enabled, setEnabled] = useState(existing?.enabled ?? true);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const submitLabel = submitLabelFor(pending, editing);
	const submitting = useRef(false);
	const creation = useIdempotencyKey();

	const adapter = useMemo(
		() => adapters.find((entry) => entry.id === adapterKey),
		[adapters, adapterKey],
	);
	const required = adapter?.credentials.required ?? [];
	const catalog = adapter?.models ?? [];
	const known = isKnownUpstreamModel(catalog, upstreamModel);
	const custom = !known;
	const sameStoredModel = existing?.upstreamModel === upstreamModel.trim();
	const catalogTransports = sameStoredModel
		? (existing?.transportOverrides ?? {})
		: {};

	/** Capture one snapshot for validation and saving, including collapsed advanced fields. */
	function readForm(form: FormData): CreateDeploymentInput {
		if (!adapter) {
			throw new Error("Choose an adapter.");
		}
		const credentials: Record<string, unknown> = {};
		for (const field of required) {
			const value = optionalText(form.get(`cred_${field}`));
			if (value !== undefined) {
				credentials[field] = value;
			}
		}
		const extra = parseObject(
			String(form.get("credentialsExtra") ?? ""),
			"Extra credentials",
		);
		if (extra) {
			Object.assign(credentials, extra);
		}
		const entry = custom
			? parseCustomEntry(technical ?? JSON.stringify(customEntry))
			: undefined;
		const rates = parsePricing(pricing);
		const body: CreateDeploymentInput = {
			publicModel: String(form.get("publicModel")).trim(),
			adapterKey,
			upstreamModel: upstreamModel.trim(),
			credentials,
			label: optionalText(form.get("label")) ?? null,
			failureDomain: optionalText(form.get("failureDomain")) ?? null,
			metadata:
				parseObject(String(form.get("metadata") ?? ""), "Metadata") ?? {},
			transportOverrides: entry
				? selectedTransports(entry, transports)
				: catalogTransports,
			enabled,
			tpmLimit: optionalNumber(form.get("tpmLimit")) ?? null,
			rpmLimit: optionalNumber(form.get("rpmLimit")) ?? null,
		};
		if (entry) {
			body.catalogEntry = entry;
		}
		if (rates) {
			body.pricing = rates;
		}
		const weight = optionalNumber(form.get("weight"));
		if (weight !== undefined) {
			body.weight = weight;
		}
		return body;
	}

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (submitting.current) {
			return;
		}
		submitting.current = true;
		setError(null);
		setPending(true);
		try {
			const body = readForm(new FormData(event.currentTarget));
			const result = await saveDeploymentAction(
				body,
				existing?.id,
				creation.key(),
			);
			if (!result.ok) {
				setError(result.message);
				return;
			}
			creation.rotate();
			await onSaved();
			onClose();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not save the deployment.",
			);
		} finally {
			submitting.current = false;
			setPending(false);
		}
	}

	return (
		<Modal
			className="md:w-2xl"
			isOpen={isOpen}
			onOpenChange={(open) => !open && onClose()}
		>
			<Dialog
				aria-label={editing ? "Edit deployment" : "New deployment"}
				layout="sectioned"
			>
				<DialogHeader>
					<h2 className="font-semibold text-foreground text-xl">
						{editing ? "Edit deployment" : "New deployment"}
					</h2>
					<p className="text-fg-muted text-sm">
						Connect a public model to a provider.
					</p>
				</DialogHeader>

				<Form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={onSubmit}
					onSubmitCapture={(event) => {
						// Emit native invalid events so collapsed fields reveal their errors.
						event.currentTarget.checkValidity();
					}}
				>
					<DialogBody>
						<div className="grid gap-4 sm:grid-cols-2">
							<Input
								autoFocus
								defaultValue={existing?.publicModel ?? ""}
								description="The name clients send as `model`."
								label="Public model"
								name="publicModel"
								required
							/>
							<SearchableSelect
								description={
									editing ? "Fixed for an existing deployment." : undefined
								}
								disabled={editing}
								items={adapters.map((entry) => ({
									value: entry.id,
									label: entry.id,
								}))}
								label="Adapter"
								name="adapterKey"
								onValueChange={(key) => {
									if (!key || key === adapterKey) {
										return;
									}
									setAdapterKey(key);
									setUpstreamModel("");
									setCustomEntry(
										initialCustomEntry(
											(
												adapters.find((entry) => entry.id === key)
													?.operations ?? []
											).map((operation) => operation.id),
										),
									);
									setTechnical(null);
									setTransports({});
								}}
								placeholder="Choose an adapter"
								required
								searchPlaceholder="Search adapters"
								value={adapterKey || null}
							/>
						</div>

						{catalog.length > 0 ? (
							/**
							 * A combo box, not a select: the catalog is a strong suggestion, not a closed
							 * set. A dated snapshot ("gpt-5.5-2026-04-23") resolves through its base entry,
							 * and a genuinely new model can be deployed as custom on an adapter that has a
							 * catalog — a select would make both impossible.
							 */
							<ModelInput
								emptyHint="No catalog match. You can use this custom model id."
								label="Upstream model"
								models={catalog.map((model) => model.id)}
								onChange={setUpstreamModel}
								placeholder="Pick a catalog model or type an id"
								renderItem={(id) => (
									<>
										{id}
										{catalog.find((model) => model.id === id)?.deprecated ? (
											<Status tone="warning">deprecated</Status>
										) : null}
									</>
								)}
								required
								value={upstreamModel}
							/>
						) : (
							<Input
								disabled={!adapter}
								label="Upstream model"
								onValueChange={setUpstreamModel}
								placeholder={
									adapter ? "Enter a model ID" : "Choose an adapter first"
								}
								required
								value={upstreamModel}
							/>
						)}

						{required.map((field) => (
							<Input
								autoComplete="off"
								description={
									editing ? "Leave blank to keep the stored value." : undefined
								}
								key={`${adapterKey}:${field}`}
								label={CREDENTIAL_LABELS[field] ?? field}
								name={`cred_${field}`}
								required={!editing}
								type={field === "baseUrl" ? "url" : "password"}
							/>
						))}

						{custom && upstreamModel.trim() ? (
							<CustomModelEditor
								key={adapterKey}
								onChange={setCustomEntry}
								onTechnicalChange={setTechnical}
								onTransportsChange={setTransports}
								operations={adapter?.operations ?? []}
								technical={technical}
								transports={transports}
								value={customEntry}
							/>
						) : null}

						<Collapsible.Root
							onOpenChange={setAdvancedOpen}
							open={advancedOpen}
						>
							<Collapsible.Trigger className="w-full transition-none [&>svg]:transition-none">
								Advanced options
								<IconChevronDown aria-hidden className="size-4" />
							</Collapsible.Trigger>
							<Collapsible.Panel
								className="h-auto overflow-visible transition-none data-closed:hidden"
								keepMounted
								onInvalidCapture={() => setAdvancedOpen(true)}
							>
								<div className="flex flex-col gap-4 pt-5">
									<JsonField
										description='Adapter-specific extras such as {"baseUrl": "https://…"}.'
										label="Extra credentials (JSON)"
										name="credentialsExtra"
										rows={2}
									/>

									<div className="grid gap-4 sm:grid-cols-2">
										<Input
											defaultValue={existing?.label ?? ""}
											description="Tells deployments of the same model apart, e.g. which API key."
											label="Label"
											name="label"
										/>
										<Input
											defaultValue={existing?.failureDomain ?? ""}
											description="Deployments sharing this value share upstream throttle state."
											label="Failure domain"
											name="failureDomain"
										/>
									</div>

									<div className="grid gap-4 sm:grid-cols-3">
										<Input
											defaultValue={String(existing?.weight ?? 1)}
											description="Share under simple-shuffle."
											label="Weight"
											min={0}
											name="weight"
											step={1}
											type="number"
										/>
										<Input
											defaultValue={
												existing?.rpmLimit === null ||
												existing?.rpmLimit === undefined
													? ""
													: String(existing.rpmLimit)
											}
											label="RPM limit"
											name="rpmLimit"
											type="number"
										/>
										<Input
											defaultValue={
												existing?.tpmLimit === null ||
												existing?.tpmLimit === undefined
													? ""
													: String(existing.tpmLimit)
											}
											label="TPM limit"
											name="tpmLimit"
											type="number"
										/>
									</div>

									<Switch checked={enabled} onCheckedChange={setEnabled}>
										Enabled
									</Switch>

									<PricingEditor onChange={setPricing} value={pricing} />
									<JsonField
										defaultValue={
											existing?.metadata &&
											Object.keys(existing.metadata).length > 0
												? JSON.stringify(existing.metadata, null, 2)
												: ""
										}
										description="Free-form operator annotations, up to 16 KiB. Stored and returned verbatim."
										label="Metadata (JSON)"
										name="metadata"
										rows={3}
									/>
									{known && Object.keys(catalogTransports).length > 0 ? (
										<div className="text-fg-muted text-sm">
											<p>
												Stored transport overrides are preserved for this model
												(read-only).
											</p>
											<ul className="mt-2 list-inside list-disc">
												{Object.entries(catalogTransports).map(
													([operation, transport]) => (
														<li key={operation}>
															{operation}: {transport}
														</li>
													),
												)}
											</ul>
										</div>
									) : null}
								</div>
							</Collapsible.Panel>
						</Collapsible.Root>
					</DialogBody>
					<DialogFooter>
						{error ? (
							<div className="w-full">
								<ErrorNote>{error}</ErrorNote>
							</div>
						) : null}
						<Button onClick={onClose} variant="secondary">
							Cancel
						</Button>
						<Button disabled={pending} type="submit">
							{submitLabel}
						</Button>
					</DialogFooter>
				</Form>
			</Dialog>
		</Modal>
	);
}

function JsonField({
	name,
	label,
	description,
	rows,
	defaultValue,
}: {
	name: string;
	label: string;
	description?: string;
	rows: number;
	defaultValue?: string;
}) {
	return (
		<Textarea
			className="resize-y font-mono text-xs"
			defaultValue={defaultValue}
			description={description}
			label={label}
			name={name}
			rows={rows}
			spellCheck={false}
		/>
	);
}
