import {
	REALTIME_OUTPUT_SAMPLE_RATE,
	REALTIME_AUDIO_SAMPLE_RATE,
} from "#core/realtime.ts";

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

const SEG_A_END = [0x1f, 0x3f, 0x7f, 0xff, 0x1_ff, 0x3_ff, 0x7_ff, 0xf_ff];
const SEG_U_END = [0x3f, 0x7f, 0xff, 0x1_ff, 0x3_ff, 0x7_ff, 0xf_ff, 0x1f_ff];

function segment(value: number, ends: number[]): number {
	const index = ends.findIndex((end) => value <= end);
	return index === -1 ? ends.length : index;
}

/** ITU-T G.711 A-law, after the CCITT reference implementation (`linear2alaw`). */
function encodeALaw(sample: number): number {
	let value = sample >> 3;
	let mask = 0xd5;
	if (value < 0) {
		mask = 0x55;
		value = -value - 1;
	}
	const seg = segment(value, SEG_A_END);
	if (seg >= 8) {
		return 0x7f ^ mask;
	}
	const quantized = seg < 2 ? (value >> 1) & 0x0f : (value >> seg) & 0x0f;
	return ((seg << 4) | quantized) ^ mask;
}

/** ITU-T G.711 mu-law, after the CCITT reference implementation (`linear2ulaw`). */
function encodeMuLaw(sample: number): number {
	let value = sample >> 2;
	let mask = 0xff;
	if (value < 0) {
		value = -value;
		mask = 0x7f;
	}
	value = Math.min(value, 8159) + (0x84 >> 2);
	const seg = segment(value, SEG_U_END);
	if (seg >= 8) {
		return 0x7f ^ mask;
	}
	return ((seg << 4) | ((value >> (seg + 1)) & 0x0f)) ^ mask;
}

// biome-ignore-end lint/suspicious/noBitwiseOperators: end of the G.711 codecs.

const MU_LAW = Int16Array.from({ length: 256 }, (_, byte) => decodeMuLaw(byte));
const A_LAW = Int16Array.from({ length: 256 }, (_, byte) => decodeALaw(byte));

/** Linear-interpolation resampler (to the canonical rate by default), stateful across chunks. */
class Resampler {
	private readonly step: number;
	private readonly smooth: boolean;
	private pending: number[] = [];
	private position = 0;
	private previous: [number, number] | null = null;

	constructor(inputRate: number, outputRate = REALTIME_AUDIO_SAMPLE_RATE) {
		this.step = inputRate / outputRate;
		this.smooth = inputRate > outputRate;
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

/**
 * Canonical 16 kHz PCM16 at another rate, for a provider that takes only that rate (OpenAI's
 * Realtime API: 24 kHz).
 */
export function createPcmResampler(
	outputRate: number,
): (pcm: Buffer) => Buffer {
	const resampler = new Resampler(REALTIME_AUDIO_SAMPLE_RATE, outputRate);
	let carry: Buffer | null = null;
	return (chunk) => {
		const data: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
		const even = data.byteLength - (data.byteLength % 2);
		carry = even < data.byteLength ? data.subarray(even) : null;
		const samples = new Int16Array(even / 2);
		for (let index = 0; index < samples.length; index += 1) {
			samples[index] = data.readInt16LE(index * 2);
		}
		return resampler.push(samples);
	};
}

/* ------------------------------------------------------------------ output */

export type RealtimeOutputAudioFormat =
	| { type: "audio/pcm"; rate: number }
	| { type: "audio/pcmu" }
	| { type: "audio/pcma" };

export interface AudioOutputEncoder {
	/** 24 kHz PCM16 from the provider in, the client's format out. */
	push: (pcm: Buffer) => Buffer;
}

/** Sample index -> G.711 byte, built on first use. */
const encodeTables = new Map<"audio/pcmu" | "audio/pcma", Uint8Array>();

function encodeTable(type: "audio/pcmu" | "audio/pcma"): Uint8Array {
	let table = encodeTables.get(type);
	if (!table) {
		const encode = type === "audio/pcmu" ? encodeMuLaw : encodeALaw;
		table = Uint8Array.from({ length: 65_536 }, (_, index) =>
			encode(index - 32_768),
		);
		encodeTables.set(type, table);
	}
	return table;
}

/**
 * Provider speech (24 kHz PCM16) in the client's output format. PCM passes through; G.711 needs
 * 8 kHz, so every three samples are averaged into one (a box filter is enough for speech) and
 * companded.
 */
export function createAudioOutputEncoder(
	format: RealtimeOutputAudioFormat,
): AudioOutputEncoder {
	if (format.type === "audio/pcm") {
		let carry: Buffer | null = null;
		return {
			push(chunk) {
				const data: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
				const even = data.byteLength - (data.byteLength % 2);
				carry = even < data.byteLength ? data.subarray(even) : null;
				return data.subarray(0, even);
			},
		};
	}
	const table = encodeTable(format.type);
	const factor = REALTIME_OUTPUT_SAMPLE_RATE / 8000;
	let carry = Buffer.alloc(0);
	return {
		push(chunk) {
			const data = carry.byteLength > 0 ? Buffer.concat([carry, chunk]) : chunk;
			const frameBytes = factor * 2;
			const frames = Math.floor(data.byteLength / frameBytes);
			const out = Buffer.alloc(frames);
			for (let frame = 0; frame < frames; frame += 1) {
				let total = 0;
				for (let index = 0; index < factor; index += 1) {
					total += data.readInt16LE((frame * factor + index) * 2);
				}
				out[frame] = table[Math.round(total / factor) + 32_768] ?? 0;
			}
			carry = Buffer.from(data.subarray(frames * frameBytes));
			return out;
		},
	};
}
