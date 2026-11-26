import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FRAME_SAMPLES, MicTap } from '../src/mic.js';
import { SileroVad } from '../src/silero.js';
import { EnergyVad } from '../src/vad.js';
import { speechFrame } from './helpers.js';

function wavSamples(path: string | URL): Int16Array {
  const file = readFileSync(path);
  let offset = 12;
  while (offset + 8 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    if (id === 'data') {
      const bytes = file.subarray(offset + 8, offset + 8 + size);
      const samples = new Int16Array(bytes.length / 2);
      Buffer.from(samples.buffer).set(bytes);
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`No data chunk in ${path}`);
}

async function feed(mic: MicTap, samples: Int16Array) {
  let speech = 0;
  let frames = 0;
  const stop = mic.subscribe((frame) => {
    frames++;
    if (frame.speech) speech++;
  });
  for (let i = 0; i < samples.length; i += FRAME_SAMPLES) {
    await mic.push(samples.subarray(i, Math.min(i + FRAME_SAMPLES, samples.length)));
  }
  stop();
  return { speech, frames };
}

test('Silero hears speech and ignores a loud tone', async () => {
  const silero = await SileroVad.load();
  const spoken = wavSamples(new URL('./fixtures/speech.wav', import.meta.url));
  const speech = await feed(new MicTap(silero), spoken);
  assert.ok(speech.frames > 20, 'the sample produced frames');
  assert.ok(speech.speech / speech.frames > 0.35, `only ${speech.speech}/${speech.frames} frames were speech`);

  const tone = new Int16Array(FRAME_SAMPLES * 50);
  for (let i = 0; i < 50; i++) tone.set(speechFrame(), i * FRAME_SAMPLES);
  const noise = await feed(new MicTap(await SileroVad.load()), tone);
  assert.ok(noise.speech / noise.frames < 0.1, `a tone was called speech ${noise.speech}/${noise.frames} times`);

  const energy = new EnergyVad();
  let loud = 0;
  for (let i = 0; i < 50; i++) if (energy.process(speechFrame()).speech) loud++;
  assert.ok(loud > 40, 'the loudness detector still treats that tone as speech');
});
