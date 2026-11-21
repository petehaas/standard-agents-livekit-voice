import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heardPortion, pcmToWav } from '../../agent/src/voice/audio.js';
import { frameDb } from '../src/vad.js';
import { FRAME_MS, MicTap } from '../src/mic.js';
import { silenceFrame, speechFrame } from './helpers.js';

test('VAD separates speech from background noise', () => {
  assert.ok(frameDb(speechFrame()) > -20);
  assert.ok(frameDb(silenceFrame()) < -60);

  const mic = new MicTap();
  const seen: boolean[] = [];
  mic.subscribe((frame) => seen.push(frame.speech));
  for (let i = 0; i < 50; i++) mic.push(silenceFrame()); // 1 s to learn the floor
  for (let i = 0; i < 25; i++) mic.push(speechFrame()); // 500 ms of speech
  for (let i = 0; i < 25; i++) mic.push(silenceFrame());

  assert.equal(seen.slice(0, 50).filter(Boolean).length, 0, 'no speech in the noise');
  assert.ok(seen.slice(50, 75).filter(Boolean).length >= 23, 'speech is detected within two frames');
  assert.equal(mic.speechRunMs, 0);
});

test('soft speech still counts once the floor is learned', () => {
  const mic = new MicTap();
  for (let i = 0; i < 50; i++) mic.push(silenceFrame(10));
  for (let i = 0; i < 10; i++) mic.push(speechFrame(300)); // about -40 dBFS
  assert.ok(mic.speechRunMs >= 160);
});

test('MicTap reframes arbitrary chunk sizes into 20 ms frames', () => {
  const mic = new MicTap();
  let frames = 0;
  mic.subscribe(() => frames++);
  mic.push(new Int16Array(500));
  mic.push(new Int16Array(460)); // 960 samples = three 320-sample frames
  assert.equal(frames, 3);
});

test('a barge-in mark returns the interrupting words plus pre-roll', () => {
  const mic = new MicTap();
  for (let i = 0; i < 30; i++) mic.push(silenceFrame());
  for (let i = 0; i < 15; i++) mic.push(speechFrame()); // 300 ms
  mic.markTurnStart();
  for (let i = 0; i < 10; i++) mic.push(silenceFrame()); // the caller pauses
  const turn = mic.takeTurnStart(100)!;
  assert.ok(turn, 'mark is kept across a pause');
  // ~300 ms of speech run (minus smoothing) + 200 ms pause + 100 ms pre-roll
  assert.ok(turn.length * FRAME_MS >= 540 && turn.length * FRAME_MS <= 620, `got ${turn.length * FRAME_MS} ms`);
  assert.equal(mic.takeTurnStart(100), null, 'mark is consumed');
});

test('heardPortion keeps the words played before an interruption', () => {
  const text = 'one two three four five six seven eight nine ten';
  assert.equal(heardPortion(text, 500, 2000), 'one two three');
  assert.equal(heardPortion(text, 0, 2000), '');
  assert.equal(heardPortion(text, 5000, 2000), text);
  assert.equal(heardPortion(text, 1000), 'one two three'); // rate estimate: 2.6 words/s
});

test('pcmToWav writes a valid 16 kHz mono header', () => {
  const wav = pcmToWav(new Uint8Array(3200), 16_000);
  const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(40, true), 3200);
  assert.equal(wav.byteLength, 3244);
});
