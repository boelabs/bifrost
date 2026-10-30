import { REALTIME_AUDIO_SAMPLE_RATE } from "#core/realtime.ts";

/**
 * Streaming conversion of realtime client audio into the canonical 16 kHz PCM16.
 *
 * Chunks arrive at arbitrary boundaries (an odd byte, half a resampling window), so each decoder
 * keeps the little state it needs between `push` calls. Resampling is linear interpolation; when
 * downsampling, a 3-tap smoothing filter first takes the edge off what would otherwise alias. That is
 * plenty for speech recognition, which is all this audio is for.
 */

export type RealtimeInputAudioFormat =
	| { type: "audio/pcm"; rate: number }
	| { type: "audio/pcmu" }
	| { type: "audio/pcma" };

export interface AudioInputDecoder {
	/** Raw client bytes in, canonical PCM16 out (possibly empty while a window fills). */
	push: (bytes: Buffer) => Buffer;
	/** Seconds of client audio pushed so far. */
	readonly seconds: number;
}

// biome-ignore-start lint/suspicious/noBitwiseOperators: ITU-T G.711 defines its codes as bit fields; anything else would obscure the standard.
function decodeMuLaw(byte: number): number {
	const value = ~byte & 0xff;
	const sign = value & 0x80;
	const exponent = (value >> 4) & 0x07;
	const mantissa = value & 0x0f;
	const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
	return sign ? -sample : sample;
}

function decodeALaw(byte: number): number {
	const value = byte ^ 0x55;
	const sign = value & 0x80;
	const exponent = (value >> 4) & 0x07;
	const mantissa = value & 0x0f;
	const sample =
		exponent === 0
			? (mantissa << 4) + 8
			: ((mantissa << 4) + 0x1_08) << (exponent - 1);
	return sign ? sample : -sample;
}

// biome-ignore-end lint/suspicious/noBitwiseOperators: end of the G.711 decoders.

const MU_LAW = Int16Array.from({ length: 256 }, (_, byte) => decodeMuLaw(byte));
const A_LAW = Int16Array.from({ length: 256 }, (_, byte) => decodeALaw(byte));

/** Linear-interpolation resampler to the canonical rate, stateful across chunks. */
class Resampler {
	private readonly step: number;
	private readonly smooth: boolean;
	private pending: number[] = [];
	private position = 0;
	private previous: [number, number] | null = null;

	constructor(inputRate: number) {
		this.step = inputRate / REALTIME_AUDIO_SAMPLE_RATE;
		this.smooth = inputRate > REALTIME_AUDIO_SAMPLE_RATE;
	}

	push(samples: ArrayLike<number>): Buffer {
		if (this.step === 1) {
			return pcm16(Array.from(samples));
		}
		for (const sample of Array.from(samples)) {
			if (this.smooth) {
				// The filter is centred, so each sample comes out one input later.
				if (this.previous) {
					const [before, current] = this.previous;
					this.pending.push((before + 2 * current + sample) / 4);
					this.previous = [current, sample];
				} else {
					this.pending.push(sample);
					this.previous = [sample, sample];
				}
			} else {
				this.pending.push(sample);
			}
		}
		const out: number[] = [];
		while (this.position + 1 < this.pending.length) {
			const index = Math.floor(this.position);
			const fraction = this.position - index;
			const a = this.pending[index] ?? 0;
			const b = this.pending[index + 1] ?? 0;
			out.push(a + (b - a) * fraction);
			this.position += this.step;
		}
		const consumed = Math.floor(this.position);
		this.pending = this.pending.slice(consumed);
		this.position -= consumed;
		return pcm16(out);
	}
}

function pcm16(samples: number[]): Buffer {
	const out = Buffer.alloc(samples.length * 2);
	for (const [index, sample] of samples.entries()) {
		out.writeInt16LE(
			Math.max(-32_768, Math.min(32_767, Math.round(sample))),
			index * 2,
		);
	}
	return out;
}

export function createAudioInputDecoder(
	format: RealtimeInputAudioFormat,
): AudioInputDecoder {
	if (format.type === "audio/pcm") {
		const resampler = new Resampler(format.rate);
		let carry: Buffer | null = null;
		let bytes = 0;
		return {
			push(chunk) {
				bytes += chunk.byteLength;
				const data: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
				const even = data.byteLength - (data.byteLength % 2);
				carry = even < data.byteLength ? data.subarray(even) : null;
				const samples = new Int16Array(even / 2);
				for (let index = 0; index < samples.length; index += 1) {
					samples[index] = data.readInt16LE(index * 2);
				}
				return resampler.push(samples);
			},
			get seconds() {
				return bytes / 2 / format.rate;
			},
		};
	}
	const table = format.type === "audio/pcmu" ? MU_LAW : A_LAW;
	const resampler = new Resampler(8000);
	let bytes = 0;
	return {
		push(chunk) {
			bytes += chunk.byteLength;
			const samples = new Int16Array(chunk.byteLength);
			for (let index = 0; index < chunk.byteLength; index += 1) {
				samples[index] = table[chunk[index] ?? 0] ?? 0;
			}
			return resampler.push(samples);
		},
		get seconds() {
			return bytes / 8000;
		},
	};
}
