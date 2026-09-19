"use client";

import { Select, SelectItem } from "#/components/ui/select";
import { ToggleGroup } from "#/components/ui/toggle-group";
import { NumberField } from "#/components/ui/number-field";
import { buttonStyles } from "#/components/ui/button";
import { Toggle } from "#/components/ui/toggle";
import { Input } from "#/components/ui/input";
import { useState } from "react";

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
	VIDEO_ASPECT_RATIOS,
	type VideoSettings,
	VIDEO_RESOLUTIONS,
	VIDEO_QUALITIES,
	type VideoTask,
	VIDEO_TASKS,
} from "./videos";

const DEFAULT = "default";

/**
 * How the dimensions are being said. The gateway takes `size` or `aspect_ratio`/`resolution` and
 * refuses both at once, so the choice is made here, once — the invalid combination cannot be
 * expressed rather than being validated after the fact.
 */
type Dimensions = "default" | "ratio" | "size";

export function dimensionsOf(settings: VideoSettings): Dimensions {
	if (settings.size !== undefined) {
		return "size";
	}
	if (settings.aspectRatio !== undefined || settings.resolution !== undefined) {
		return "ratio";
	}
	return "default";
}

/** One optional control. "Default" is the absence of a value, not a value. */
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
			onValueChange={(next) =>
				onChange(next === DEFAULT || next === null ? undefined : next)
			}
			value={value ?? DEFAULT}
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

export function VideoSettingsDialog({
	open,
	onOpenChange,
	settings,
	onSettings,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	settings: VideoSettings;
	onSettings: (settings: VideoSettings) => void;
}) {
	/**
	 * Which form is on screen is the operator's choice, not a reading of the settings: picking
	 * "Proportion" has to show the two selects before either of them has a value. The settings still
	 * win when they change from outside — a reset empties them, and the panel follows.
	 */
	const chosen = dimensionsOf(settings);
	const [dimensions, setDimensions] = useState<Dimensions>(chosen);
	const [tracked, setTracked] = useState<Dimensions>(chosen);
	if (tracked !== chosen) {
		setTracked(chosen);
		setDimensions(chosen);
	}

	function set<Key extends keyof VideoSettings>(
		key: Key,
		value: VideoSettings[Key],
	) {
		const next = { ...settings };
		if (value === undefined || value === "") {
			delete next[key];
		} else {
			next[key] = value;
		}
		onSettings(next);
	}

	/** Switching how dimensions are said drops the other form, which is what keeps the two apart. */
	function chooseDimensions(next: Dimensions) {
		setDimensions(next);
		const cleared = { ...settings };
		delete cleared.size;
		delete cleared.aspectRatio;
		delete cleared.resolution;
		onSettings(cleared);
	}

	return (
		<DialogRoot onOpenChange={onOpenChange} open={open}>
			<DialogContent className="md:w-xl" layout="sectioned">
				<DialogHeader>
					<DialogTitle>Video settings</DialogTitle>
					<DialogDescription>
						Anything left on Default is not sent, so the model applies its own.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<div className="grid gap-5 sm:grid-cols-2">
						<Optional
							description="What kind of generation this is. Left out, the model decides from the attachments."
							label="Task"
							onChange={(value) => set("task", value as VideoTask | undefined)}
							value={settings.task}
							values={VIDEO_TASKS}
						/>
						<Optional
							label="Quality"
							onChange={(value) => set("quality", value)}
							value={settings.quality}
							values={VIDEO_QUALITIES}
						/>
						<NumberField.Root
							max={300}
							min={1}
							onValueChange={(value) => set("seconds", value ?? undefined)}
							step={1}
							value={settings.seconds ?? null}
						>
							<NumberField.ScrubArea>
								<label
									className="font-medium text-sm"
									htmlFor="playground-video-seconds"
								>
									Duration
								</label>
							</NumberField.ScrubArea>
							<NumberField.Group>
								<NumberField.Decrement aria-label="Shorter video" />
								<NumberField.Input
									id="playground-video-seconds"
									placeholder="Default"
								/>
								<NumberField.Increment aria-label="Longer video" />
							</NumberField.Group>
							<p className="text-fg-muted text-xs">
								Seconds. Most models accept only a few fixed lengths.
							</p>
						</NumberField.Root>
						<NumberField.Root
							max={2_147_483_647}
							min={0}
							onValueChange={(value) => set("seed", value ?? undefined)}
							step={1}
							value={settings.seed ?? null}
						>
							<NumberField.ScrubArea>
								<label
									className="font-medium text-sm"
									htmlFor="playground-video-seed"
								>
									Seed
								</label>
							</NumberField.ScrubArea>
							<NumberField.Group>
								<NumberField.Decrement aria-label="Lower seed" />
								<NumberField.Input
									id="playground-video-seed"
									placeholder="Default"
								/>
								<NumberField.Increment aria-label="Higher seed" />
							</NumberField.Group>
							<p className="text-fg-muted text-xs">
								The same seed and prompt should give the same video again.
							</p>
						</NumberField.Root>
						<Select
							description="Whether the model should score the video."
							label="Audio"
							onValueChange={(value) =>
								set(
									"generateAudio",
									value === DEFAULT || value === null
										? undefined
										: value === "on",
								)
							}
							value={
								settings.generateAudio === undefined
									? DEFAULT
									: settings.generateAudio
										? "on"
										: "off"
							}
						>
							<SelectItem value={DEFAULT}>Default</SelectItem>
							<SelectItem value="on">Generate audio</SelectItem>
							<SelectItem value="off">Silent</SelectItem>
						</Select>
					</div>
					<fieldset className="flex flex-col gap-3">
						<legend className="font-medium text-sm">Dimensions</legend>
						<p className="-mt-1 text-fg-muted text-xs">
							A proportion or exact pixels — the two are the same setting said
							two ways, and a model takes one of them.
						</p>
						<ToggleGroup
							aria-label="How to give the dimensions"
							onValueChange={(value) => {
								const [next] = value;
								if (next) {
									chooseDimensions(next as Dimensions);
								}
							}}
							value={[dimensions]}
						>
							<Toggle size="xs" value="default" variant="ghost">
								Default
							</Toggle>
							<Toggle size="xs" value="ratio" variant="ghost">
								Proportion
							</Toggle>
							<Toggle size="xs" value="size" variant="ghost">
								Exact size
							</Toggle>
						</ToggleGroup>
						{dimensions === "ratio" ? (
							<div className="grid gap-5 sm:grid-cols-2">
								<Optional
									label="Aspect ratio"
									onChange={(value) => set("aspectRatio", value)}
									value={settings.aspectRatio}
									values={VIDEO_ASPECT_RATIOS}
								/>
								<Optional
									label="Resolution"
									onChange={(value) => set("resolution", value)}
									value={settings.resolution}
									values={VIDEO_RESOLUTIONS}
								/>
							</div>
						) : null}
						{dimensions === "size" ? (
							<Input
								description="Width by height in pixels, such as 1280x720."
								label="Size"
								onChange={(event) => set("size", event.target.value.trim())}
								placeholder="1280x720"
								value={settings.size ?? ""}
							/>
						) : null}
					</fieldset>
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
