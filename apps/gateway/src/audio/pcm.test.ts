import { createAudioInputDecoder } from "./pcm.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function sine(rate: number, seconds: number, hz = 440): Buffer {
	const samples = Math.round(rate * seconds);
	const out = Buffer.alloc(samples * 2);
	for (let index = 0; index < samples; index += 1) {
		out.writeInt16LE(
			Math.round(10_000 * Math.sin((2 * Math.PI * hz * index) / rate)),
			index * 2,
		);
	}
	return out;
}

function samplesOf(pcm: Buffer): number[] {
	return Array.from({ length: pcm.byteLength / 2 }, (_, index) =>
		pcm.readInt16LE(index * 2),
	);
}

test("pcm: 16 kHz PCM passes through unchanged", () => {
	const decoder = createAudioInputDecoder({ type: "audio/pcm", rate: 16_000 });
	const input = sine(16_000, 0.1);
	assert.deepEqual(decoder.push(input), input);
	assert.equal(decoder.seconds, 0.1);
});

test("pcm: 24 kHz PCM becomes 16 kHz with the signal intact", () => {
	const decoder = createAudioInputDecoder({ type: "audio/pcm", rate: 24_000 });
	const out = decoder.push(sine(24_000, 1));
	const samples = samplesOf(out);
	// One second of audio, minus the interpolation window still waiting for its next sample.
	assert.ok(Math.abs(samples.length - 16_000) <= 2, String(samples.length));
	const peak = Math.max(...samples.map(Math.abs));
	assert.ok(peak > 9000 && peak <= 10_000, String(peak));
	assert.equal(decoder.seconds, 1);
});

test("pcm: chunk boundaries, odd bytes included, do not change the output", () => {
	const input = sine(24_000, 0.25);
	const whole = createAudioInputDecoder({ type: "audio/pcm", rate: 24_000 });
	const expected = whole.push(input);
	const chunked = createAudioInputDecoder({ type: "audio/pcm", rate: 24_000 });
	const parts: Buffer[] = [];
	for (let offset = 0; offset < input.byteLength; offset += 777) {
		parts.push(chunked.push(input.subarray(offset, offset + 777)));
	}
	assert.deepEqual(Buffer.concat(parts), expected);
});

test("pcm: G.711 mu-law and A-law decode to the standard values and double the rate", () => {
	const mu = createAudioInputDecoder({ type: "audio/pcmu" });
	// 0xFF and 0x7F are mu-law's two zeros; 0x00 is its most negative code.
	const muOut = samplesOf(mu.push(Buffer.from([0xff, 0xff, 0x00, 0x00, 0x80])));
	assert.equal(muOut[0], 0);
	assert.ok(muOut.includes(-32_124));
	assert.equal(mu.seconds, 5 / 8000);

	const a = createAudioInputDecoder({ type: "audio/pcma" });
	// 0xD5 is A-law's smallest positive code (+8), 0x55 its smallest negative (-8).
	const aOut = samplesOf(a.push(Buffer.from([0xd5, 0xd5, 0x55, 0x55, 0xd5])));
	assert.equal(aOut[0], 8);
	assert.ok(aOut.includes(-8));
	// 8 kHz -> 16 kHz: about two output samples per input sample.
	assert.ok(aOut.length >= 7 && aOut.length <= 9, String(aOut.length));
});
