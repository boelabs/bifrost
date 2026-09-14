"use client";

import { TranscriptionWorkspace } from "./TranscriptionWorkspace";
import { EmptyState, PageHeader } from "#/components/ui/page";
import { EmbeddingWorkspace } from "./EmbeddingWorkspace";
import { RerankWorkspace } from "./RerankWorkspace";
import { ImageWorkspace } from "./ImageWorkspace";
import { VideoWorkspace } from "./VideoWorkspace";
import type { Capability } from "./capabilities";
import { TextWorkspace } from "./TextWorkspace";
import type { PublicEndpoint } from "./api";
import { useState } from "react";

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
				// The workspace belongs to the capability: moving to another one starts its own, which
				// is what keeps a transcript of pictures from outliving the model that made it.
				selection.capability === "image" ? (
					<ImageWorkspace
						key="image"
						model={selected}
						models={models}
						onSelect={select}
					/>
				) : selection.capability === "video" ? (
					<VideoWorkspace
						key="video"
						model={selected}
						models={models}
						onSelect={select}
					/>
				) : selection.capability === "transcription" ? (
					<TranscriptionWorkspace
						key="transcription"
						model={selected}
						models={models}
						onSelect={select}
					/>
				) : selection.capability === "rerank" ? (
					<RerankWorkspace
						key="rerank"
						model={selected}
						models={models}
						onSelect={select}
					/>
				) : selection.capability === "embedding" ? (
					<EmbeddingWorkspace
						key="embedding"
						model={selected}
						models={models}
						onSelect={select}
					/>
				) : (
					<TextWorkspace
						key="text"
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
				)
			) : (
				<EmptyState
					title="No models available"
					description="A model appears here when an enabled deployment exposes an operation this playground can run, through a compatible contract."
				/>
			)}
		</div>
	);
}
