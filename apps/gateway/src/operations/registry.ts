import type { CallType } from "#core/callType.ts";

/** Stable semantic operations. They do not describe the protocol used to execute them. */
export const OPERATION_IDS = [
	"text.generate",
	"image.generate",
	"image.edit",
	"video.generate",
	"audio.transcribe",
	"embedding.create",
	"rerank",
] as const;

export type OperationId = (typeof OPERATION_IDS)[number];

export interface OperationDefinition {
	id: OperationId;
	family: "text" | "image" | "video" | "audio" | "embedding" | "reranking";
	label: string;
	callType: CallType;
	publicEndpoints: string[];
}

export const OPERATIONS: readonly OperationDefinition[] = [
	{
		id: "text.generate",
		family: "text",
		label: "Text generation",
		callType: "chat",
		publicEndpoints: ["/v1/chat/completions", "/v1/responses", "/v1/messages"],
	},
	{
		id: "image.generate",
		family: "image",
		label: "Image generation",
		callType: "images.generations",
		publicEndpoints: ["/v1/images/generations"],
	},
	{
		id: "image.edit",
		family: "image",
		label: "Image editing",
		callType: "images.edits",
		publicEndpoints: ["/v1/images/edits"],
	},
	{
		id: "video.generate",
		family: "video",
		label: "Video generation",
		callType: "videos.generations",
		publicEndpoints: [
			"/v1/videos",
			"/v1/videos/{video_id}",
			"/v1/videos/{video_id}/content",
		],
	},
	{
		id: "audio.transcribe",
		family: "audio",
		label: "Audio transcription",
		callType: "audio.transcriptions",
		publicEndpoints: ["/v1/audio/transcriptions"],
	},
	{
		id: "embedding.create",
		family: "embedding",
		label: "Embeddings",
		callType: "embeddings",
		publicEndpoints: ["/v1/embeddings"],
	},
	{
		id: "rerank",
		family: "reranking",
		label: "Reranking",
		callType: "rerank",
		publicEndpoints: ["/v1/rerank"],
	},
] as const;

const BY_ID = new Map(OPERATIONS.map((operation) => [operation.id, operation]));
const BY_CALL_TYPE = new Map(
	OPERATIONS.flatMap((operation) => [[operation.callType, operation] as const]),
);

function getOperation(id: OperationId): OperationDefinition {
	const operation = BY_ID.get(id);
	if (!operation) throw new Error(`Unknown operation: ${id}`);
	return operation;
}

export function operationForCallType(
	callType: CallType,
): OperationDefinition | undefined {
	return BY_CALL_TYPE.get(callType);
}

export function callTypeForOperation(id: OperationId): CallType | undefined {
	return getOperation(id).callType;
}
