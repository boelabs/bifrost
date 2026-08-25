import type { AdapterContext, TranscriptionHandler } from "#adapters/types.ts";
import { type BaseCreds, requireApiKeyCreds } from "#adapters/creds.ts";
import { adapterContextDiagnostics } from "#adapters/diagnostics.ts";
import { mapUpstreamHttpError } from "#adapters/upstreamError.ts";
import { GatewayError } from "#core/errors.ts";

import {
	parseTranscriptionResponse,
	parseTranscriptionStream,
	buildTranscriptionForm,
} from "#contracts/openai/audioTransport.ts";

import {
	normalizeAzurev1BaseUrl,
	azureRefineBadRequest,
} from "#adapters/azurev1.ts";

/** Azure v1 and the legacy deployment-based API share OpenAI's multipart and response contracts. */

interface AzureAudioCreds extends BaseCreds {
	/** Azure API version. Defaults depend on the selected transcription transport. */
	apiVersion?: string;
}

const DEFAULT_V1_API_VERSION = "preview";
const DEFAULT_LEGACY_API_VERSION = "2024-06-01";

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

function apiVersion(value: unknown, fallback: string, label: string): string {
	if (value === undefined) return fallback;
	if (typeof value !== "string" || value.trim() === "") {
		throw new GatewayError({
			class: "bad_request",
			message: `${label}: credentials.apiVersion must be a non-empty string`,
			param: "credentials.apiVersion",
		});
	}
	return value.trim();
}

function withApiVersion(url: string, version: string): string {
	const parsed = new URL(url);
	parsed.searchParams.set("api-version", version);
	return parsed.toString();
}

export function makeAzureTranscriptionHandler(
	label: string,
): TranscriptionHandler {
	function mapError(err: unknown, ctx: AdapterContext): GatewayError {
		return mapUpstreamHttpError(
			err,
			{
				label,
				refineBadRequest: azureRefineBadRequest,
			},
			ctx,
		);
	}
	return {
		async buildRequest(req, ctx: AdapterContext) {
			const c = requireApiKeyCreds<AzureAudioCreds>(ctx.credentials, label);
			const legacy = ctx.transport === "azure_audio_transcriptions_legacy";
			if (legacy && req.stream) {
				const message =
					"Azure's legacy transcription transport does not support streaming.";
				throw new GatewayError({
					class: "bad_request",
					code: "unsupported_parameter",
					message,
					publicMessage: message,
					param: "stream",
				});
			}
			const version = apiVersion(
				c.apiVersion,
				legacy ? DEFAULT_LEGACY_API_VERSION : DEFAULT_V1_API_VERSION,
				label,
			);
			const url = legacy
				? `${resourceEndpoint(c.baseUrl, label)}/openai/deployments/${encodeURIComponent(ctx.upstreamModel)}/audio/transcriptions`
				: `${normalizeAzurev1BaseUrl(c.baseUrl ?? "")}/audio/transcriptions`;
			return {
				method: "POST",
				url: withApiVersion(url, version),
				// No content-type: FormData sets the multipart boundary.
				headers: { "api-key": c.apiKey, ...(c.headers ?? {}) },
				body: await buildTranscriptionForm(req, ctx.upstreamModel, {
					// Azure v1 resolves the deployment from `model`; legacy carries it in the URL.
					includeModel: !legacy,
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
