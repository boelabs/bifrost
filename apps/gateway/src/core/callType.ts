/**
 * Internal categories used by the router to select an adapter handler.
 * They are not part of the admin API and do not replace `Operation`: several public endpoints can
 * share the same CallType and the same canonical representation.
 */
const CALL_TYPES = [
	"chat",
	"images.generations",
	"images.edits",
	"videos.generations",
	"audio.transcriptions",
	"embeddings",
	"rerank",
] as const;

export type CallType = (typeof CALL_TYPES)[number];
