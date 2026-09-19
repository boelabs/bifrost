"use client";

import { TranscriptionWorkspace } from "./TranscriptionWorkspace";
import { EmptyState, PageHeader } from "#/components/ui/page";
import { EmbeddingWorkspace } from "./EmbeddingWorkspace";
import { RerankWorkspace } from "./RerankWorkspace";
import { ImageWorkspace } from "./ImageWorkspace";
import { VideoWorkspace } from "./VideoWorkspace";
import type { Capability } from "./capabilities";
import { type ReactNode, useState } from "react";
import { TextWorkspace } from "./TextWorkspace";
import type { PublicEndpoint } from "./api";

import {
	type PlaygroundModel,
	type ModelChoice,
	capabilityGroups,
} from "./models";

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

interface WorkspaceProps {
	model: PlaygroundModel;
	models: PlaygroundModel[];
	onSelect: (choice: ModelChoice) => void;
}

/**
 * The capabilities that have a workspace of their own. Anything not listed here is text, which is
 * the only workspace that also has to be told which endpoint to speak.
 */
const SPECIALISED_WORKSPACES: Partial<
	Record<Capability, (props: WorkspaceProps) => ReactNode>
> = {
	image: ImageWorkspace,
	video: VideoWorkspace,
	transcription: TranscriptionWorkspace,
	rerank: RerankWorkspace,
	embedding: EmbeddingWorkspace,
};

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
			if (first) {
				setEndpoint(first);
			}
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<PageHeader
				description="Try your models. Conversations stay in this session."
				title="Playground"
			/>
			{selected && selection ? (
				<Workspace
					capability={selection.capability}
					endpoint={endpoint}
					model={selected}
					models={models}
					onEndpoint={setEndpoint}
					onSelect={select}
				/>
			) : (
				<EmptyState
					description="A model appears here when an enabled deployment exposes an operation this playground can run, through a compatible contract."
					title="No models available"
				/>
			)}
		</div>
	);
}

/**
 * The workspace belongs to the capability: moving to another one starts its own, which is what
 * keeps a transcript of pictures from outliving the model that made it.
 */
function Workspace({
	capability,
	model,
	models,
	endpoint,
	onEndpoint,
	onSelect,
}: WorkspaceProps & {
	capability: Capability;
	endpoint: PublicEndpoint;
	onEndpoint: (endpoint: PublicEndpoint) => void;
}) {
	const Specialised = SPECIALISED_WORKSPACES[capability];
	if (Specialised) {
		return (
			<Specialised
				key={capability}
				model={model}
				models={models}
				onSelect={onSelect}
			/>
		);
	}
	return (
		<TextWorkspace
			endpoint={
				model.endpoints.includes(endpoint)
					? endpoint
					: (model.endpoints[0] ?? endpoint)
			}
			key="text"
			model={model}
			models={models}
			onEndpoint={onEndpoint}
			onSelect={onSelect}
		/>
	);
}
