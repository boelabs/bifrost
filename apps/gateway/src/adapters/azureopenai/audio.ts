import type { AdapterContext, TranscriptionHandler } from "#adapters/types.ts";
import { type BaseCreds, requireApiKeyCreds } from "#adapters/creds.ts";
import { adapterContextDiagnostics } from "#adapters/diagnostics.ts";
import { mapUpstreamHttpError } from "#adapters/upstreamError.ts";
import { azureRefineBadRequest } from "#adapters/azurev1.ts";
import { GatewayError } from "#core/errors.ts";

import {
	parseTranscriptionResponse,
	parseTranscriptionStream,
	buildTranscriptionForm,
} from "#contracts/openai/audioTransport.ts";

/**
 * Transcription on Azure OpenAI: SPECIAL CASE. The v1 surface (/openai/v1) does NOT serve audio;
 * Azure still requires the classic deployment-based API:
 *   POST {endpoint}/openai/deployments/{deployment}/audio/transcriptions?api-version=...
 * Reuses the OpenAI transport's form/parse (same response shape); only the URL + version change.
 */

interface AzureAudioCreds extends BaseCreds {
	/** api-version of the classic audio API. gpt-4o-transcribe may require a more recent one. */
	apiVersion?: string;
}

const DEFAULT_API_VERSION = "2024-06-01";

/** Resource endpoint (origin) from the baseUrl (accepts the resource or .../openai/v1). */
function resourceEndpoint(baseUrl: string | undefined, label: string): string {
	if (!baseUrl)
		throw new GatewayError({
			class: "bad_request",
			message: `${label}: missing 'baseUrl' in credentials`,
		});
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw new GatewayError({
			class: "bad_request",
			message: `${label}: credentials.baseUrl must be a valid URL`,
		});
	}
	if (url.protocol !== "https:") {
		throw new GatewayError({
			class: "bad_request",
			message: `${label}: credentials.baseUrl must use HTTPS`,
		});
	}
	return url.origin;
}

export function makeAzureTranscriptionHandler(
	label: string,
): TranscriptionHandler {
	function mapError(err: unknown): GatewayError {
		return mapUpstreamHttpError(err, {
			label,
			refineBadRequest: azureRefineBadRequest,
		});
	}
	return {
		async buildRequest(req, ctx: AdapterContext) {
			const c = requireApiKeyCreds<AzureAudioCreds>(ctx.credentials, label);
			const resource = resourceEndpoint(c.baseUrl, label);
			const version = c.apiVersion ?? DEFAULT_API_VERSION;
			const deployment = encodeURIComponent(ctx.upstreamModel);
			return {
				method: "POST",
				url: `${resource}/openai/deployments/${deployment}/audio/transcriptions?api-version=${version}`,
				// No content-type: FormData sets the multipart boundary. The deployment goes in the URL.
				headers: { "api-key": c.apiKey, ...(c.headers ?? {}) },
				body: await buildTranscriptionForm(req, ctx.upstreamModel, {
					includeModel: false,
				}),
			};
		},
		parseResponse(raw) {
			return parseTranscriptionResponse(raw);
		},
		parseStream(stream, ctx) {
			return parseTranscriptionStream(stream, {
				onTransportTerminator: (terminator) => {
					adapterContextDiagnostics(ctx).transportTerminator = terminator;
				},
			});
		},
		mapError,
	};
}
