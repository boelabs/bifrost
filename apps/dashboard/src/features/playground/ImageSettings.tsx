"use client";

import { Select, SelectItem } from "#/components/ui/select";
import { NumberField } from "#/components/ui/number-field";
import { buttonStyles } from "#/components/ui/button";

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
	type ImageSettings,
	IMAGE_BACKGROUNDS,
	IMAGE_QUALITIES,
	IMAGE_FORMATS,
	IMAGE_STYLES,
	IMAGE_SIZES,
} from "./images";

const DEFAULT = "default";

/**
 * One optional control.
 *
 * "Default" is not a value the gateway is told about — it is the absence of one. Image models
 * disagree about which sizes, qualities and formats exist, and the catalog does not describe them
 * per model, so sending a parameter nobody chose is how an operator gets a rejection they did not
 * ask for.
 */
function Optional({
	label,
	description,
	value,
	values,
	onChange,
}: {
	label: string;
	description?: string;
	value: string | undefined;
	values: readonly string[];
	onChange: (value: string | undefined) => void;
}) {
	return (
		<Select
			label={label}
			{...(description ? { description } : {})}
			value={value ?? DEFAULT}
			onValueChange={(next) =>
				onChange(next === DEFAULT || next === null ? undefined : next)
			}
		>
			<SelectItem value={DEFAULT}>Default</SelectItem>
			{values.map((entry) => (
				<SelectItem key={entry} value={entry}>
					{entry}
				</SelectItem>
			))}
		</Select>
	);
}

export function ImageSettingsDialog({
	open,
	onOpenChange,
	settings,
	onSettings,
	canEdit,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	settings: ImageSettings;
	onSettings: (settings: ImageSettings) => void;
	/** Whether this model can edit, which is what makes the size control conditional. */
	canEdit: boolean;
}) {
	function set<Key extends keyof ImageSettings>(
		key: Key,
		value: ImageSettings[Key],
	) {
		const next = { ...settings };
		if (value === undefined) delete next[key];
		else next[key] = value;
		onSettings(next);
	}
	return (
		<DialogRoot open={open} onOpenChange={onOpenChange}>
			<DialogContent layout="sectioned" className="md:w-xl">
				<DialogHeader>
					<DialogTitle>Image settings</DialogTitle>
					<DialogDescription>
						Anything left on Default is not sent, so the model applies its own.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<div className="grid gap-5 sm:grid-cols-2">
						<Optional
							label="Size"
							{...(canEdit
								? {
										description:
											"Generation only; an edit keeps the source size.",
									}
								: {})}
							value={settings.size}
							values={IMAGE_SIZES}
							onChange={(value) => set("size", value)}
						/>
						<Optional
							label="Quality"
							value={settings.quality}
							values={IMAGE_QUALITIES}
							onChange={(value) => set("quality", value)}
						/>
						<Optional
							label="Background"
							value={settings.background}
							values={IMAGE_BACKGROUNDS}
							onChange={(value) => set("background", value)}
						/>
						<Optional
							label="Output format"
							value={settings.outputFormat}
							values={IMAGE_FORMATS}
							onChange={(value) => set("outputFormat", value)}
						/>
						<Optional
							label="Style"
							value={settings.style}
							values={IMAGE_STYLES}
							onChange={(value) => set("style", value)}
						/>
						<NumberField.Root
							value={settings.n ?? null}
							onValueChange={(value) => set("n", value ?? undefined)}
							min={1}
							max={10}
							step={1}
						>
							<NumberField.ScrubArea>
								<label
									htmlFor="playground-image-n"
									className="font-medium text-sm"
								>
									Images per run
								</label>
							</NumberField.ScrubArea>
							<NumberField.Group>
								<NumberField.Decrement aria-label="Fewer images" />
								<NumberField.Input
									id="playground-image-n"
									placeholder="Default"
								/>
								<NumberField.Increment aria-label="More images" />
							</NumberField.Group>
						</NumberField.Root>
						<NumberField.Root
							value={settings.outputCompression ?? null}
							onValueChange={(value) =>
								set("outputCompression", value ?? undefined)
							}
							min={0}
							max={100}
							step={1}
						>
							<NumberField.ScrubArea>
								<label
									htmlFor="playground-image-compression"
									className="font-medium text-sm"
								>
									Compression
								</label>
							</NumberField.ScrubArea>
							<NumberField.Group>
								<NumberField.Decrement aria-label="Less compression" />
								<NumberField.Input
									id="playground-image-compression"
									placeholder="Default"
								/>
								<NumberField.Increment aria-label="More compression" />
							</NumberField.Group>
							<p className="text-fg-muted text-xs">
								JPEG and WebP only, 0-100.
							</p>
						</NumberField.Root>
					</div>
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
