import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heardPortion, pcmToWav } from '@petehaas/standard-agents-livekit-voice';
import { LISTEN_SAMPLE_RATE, PCM_FORMAT, VOICE_PROTOCOL } from '@petehaas/standard-agents-livekit-voice/protocol';
import type { HostStream } from '../src/bridge.js';
import { serveListen } from '../src/capabilities/listen.js';
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

test('a short burst does not end the turn', async () => {
  const mic = new MicTap();
  for (let i = 0; i < 30; i++) mic.push(silenceFrame());
  const abort = new AbortController();
  let bytes = 0;
  let settled = false;
  const stream = {
    metadata: {
      protocol: VOICE_PROTOCOL,
      sampleRate: LISTEN_SAMPLE_RATE,
      format: PCM_FORMAT,
      endSilenceMs: 200,
      noSpeechTimeoutMs: 2_000,
      maxUtteranceMs: 10_000,
    },
    aborted: abort.signal,
    write(chunk: Uint8Array) {
      bytes += chunk.byteLength;
    },
    end() {},
    fail() {},
  } as unknown as HostStream;

  const pending = serveListen(stream, mic, { minSpeechMs: 160, prerollMs: 100 }).then(() => {
    settled = true;
  });
  try {
    for (let i = 0; i < 10; i++) mic.push(speechFrame());
    for (let i = 0; i < 15; i++) mic.push(silenceFrame());
    assert.equal(settled, false, 'a short burst closed the turn');
    assert.equal(bytes, 0, 'the burst was sent on');
    for (let i = 0; i < 40; i++) mic.push(speechFrame());
    for (let i = 0; i < 15; i++) mic.push(silenceFrame());
    await pending;
    assert.equal(settled, true);
    assert.ok(bytes > 0);
  } finally {
    abort.abort();
    await pending;
  }
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

test('end_call refuses to hang up before the caller has spoken', async () => {
  const { endCallTool, CALL_CONNECTED, CALL_ENDED_KEY } = await import('@petehaas/standard-agents-livekit-voice');
  const values = new Map<string, unknown>();
  const stateWith = (latest: string) =>
    ({
      getMessages: async () => ({ messages: [{ role: 'assistant', content: 'Hi!' }, { role: 'user', content: latest }] }),
      setValue: async (key: string, value: unknown) => void values.set(key, value),
    }) as never;

  const early = await endCallTool.execute(stateWith(CALL_CONNECTED), { reason: 'caller said goodbye' });
  assert.match(String((early as { result: string }).result), /^Not ended/);
  assert.equal(values.has(CALL_ENDED_KEY), false);

  await endCallTool.execute(stateWith('Okay, thanks, bye!'), { reason: 'caller said goodbye' });
  assert.equal(values.get(CALL_ENDED_KEY), true);
});
