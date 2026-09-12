import type { ResponseInputItem } from "#contracts/openai/responsesRender.ts";
import type { ResponsesRequest } from "#contracts/openai/responses.ts";

export interface ConnectionResponseState {
	id: string;
	requestInput: ResponseInputItem[];
	output: ResponseInputItem[];
	warmupRequest: ResponsesRequest | null;
}

/** Carries generate:false request configuration into the generated turn that chains from it. */
export function inheritWarmupRequest(
	current: ResponsesRequest,
	state: ConnectionResponseState | null,
): ResponsesRequest {
	if (!state?.warmupRequest || current.previous_response_id !== state.id)
		return current;
	const {
		input: _input,
		previous_response_id: _previousResponseId,
		stream: _stream,
		store: _store,
		model: _model,
		...preparedDefaults
	} = state.warmupRequest;
	return {
		...preparedDefaults,
		...current,
		model: current.model,
		stream: true,
	};
}
