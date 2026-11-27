/**
 * End to end over a real WebSocket: the agent's runtime-side speak/listen
 * code talks through a mock runtime to this host's bridge client and
 * capability handlers, with a fake speaker in place of LiveKit.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { listen, speak } from '@petehaas/standard-agents-livekit-voice';
import type { TextToSpeech } from '@petehaas/standard-agents-livekit-voice';
import { CAPABILITY, LISTEN_SAMPLE_RATE } from '@petehaas/standard-agents-livekit-voice/protocol';
import { ExecutionHostBridge } from '../src/bridge.js';
import { serveListen } from '../src/capabilities/listen.js';
import { serveSpeak, type Speaker } from '../src/capabilities/speak.js';
import { MicTap } from '../src/mic.js';
import { MockRuntime, silenceFrame, sleep, speechFrame } from './helpers.js';

const runtime = new MockRuntime();
const mic = new MicTap();
const played: number[] = [];
let bridge: ExecutionHostBridge;

/** Plays in real time-ish: each 20 ms frame takes 2 ms, so tests stay fast. */
const speaker: Speaker & { queued: number } = {
  queued: 0,
  async play(samples) {
    played.push(samples.length);
    await sleep(2);
  },
  clear() {
    this.queued = 0;
  },
  queuedMs() {
    return this.queued;
  },
  async waitForPlayout() {},
};

/** Fake TTS: `ms` of a 24 kHz tone, delivered in uneven 1000-byte chunks. */
function fakeTts(ms: number, chunkDelayMs = 0): TextToSpeech & { cancelled: boolean } {
  const tts = {
    name: 'fake',
    cancelled: false,
    async synthesize(_text: string, signal: AbortSignal) {
      const bytes = new Uint8Array(((24_000 * ms) / 1000) * 2).fill(7);
      let offset = 0;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (signal.aborted || offset >= bytes.byteLength) return controller.close();
          if (chunkDelayMs) await sleep(chunkDelayMs);
          controller.enqueue(bytes.slice(offset, offset + 1000));
          offset += 1000;
        },
        cancel() {
          tts.cancelled = true;
        },
      });
    },
  };
  return tts;
}

before(async () => {
  const baseUrl = await runtime.listen();
  bridge = new ExecutionHostBridge({
    baseUrl,
    apiKey: 'agtbldr_test_key',
    threadId: 'thread-1',
    clientId: 'test-host',
    clientName: 'Test host',
    clientKind: 'media_host',
  });
  bridge
    .serve(CAPABILITY.speak, (stream) => serveSpeak(stream, speaker, mic, { bargeInEnabled: true, bargeInMs: 200 }))
    .serve(CAPABILITY.listen, (stream) => serveListen(stream, mic, { minSpeechMs: 160, prerollMs: 100 }));
  await bridge.connect();
  for (let i = 0; i < 50; i++) mic.push(silenceFrame()); // learn the noise floor
});

after(async () => {
  await bridge.close();
  await runtime.close();
});

test('the host claims the thread with its client identity and API key', () => {
  const { url, authorization } = runtime.connections[0];
  assert.equal(authorization, 'Bearer agtbldr_test_key');
  const query = new URL(url, 'http://x').searchParams;
  assert.equal(query.get('client_id'), 'test-host');
  assert.equal(query.get('claim'), 'takeover');
});

test('speak plays every byte and reports the full duration', async () => {
  played.length = 0;
  const outcome = await speak(runtime.runtimeStreams, fakeTts(1000), 'Hello there.', { bargeIn: true });
  assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
  assert.equal(outcome.interrupted, false);
  assert.equal(outcome.playedMs, 1000);
  assert.equal(outcome.totalMs, 1000);
  assert.equal(played.reduce((a, b) => a + b, 0), 24_000, 'one second of samples reached the speaker');
});

test('caller speech during playback interrupts it and cancels TTS upstream', async () => {
  const tts = fakeTts(5000, 5); // slower than playback, so synthesis is still running
  const speaking = speak(runtime.runtimeStreams, tts, 'A long answer that the caller will cut off.', { bargeIn: true });
  await sleep(150);
  for (let i = 0; i < 15; i++) mic.push(speechFrame()); // 300 ms of caller speech
  const outcome = await speaking;
  assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
  assert.equal(outcome.interrupted, true);
  assert.ok(outcome.playedMs > 0 && outcome.playedMs < 5000, `played ${outcome.playedMs} ms`);
  assert.equal(outcome.totalMs, undefined, 'synthesis had not finished');
  await sleep(50);
  assert.equal(tts.cancelled, true, 'the TTS stream was cancelled');
});

test('listen after a barge-in starts from the interrupting words', async () => {
  const listening = listen(runtime.runtimeStreams, { endSilenceMs: 300, noSpeechTimeoutMs: 2000, maxUtteranceMs: 10_000 });
  await sleep(30);
  for (let i = 0; i < 20; i++) mic.push(silenceFrame()); // 400 ms: the caller finishes
  const heard = await listening;
  assert.ok(heard.ok, heard.ok ? '' : heard.error);
  // 300 ms of interrupting speech + 100 ms pre-roll + 300 ms of end silence, give or take smoothing
  assert.ok(heard.speechMs >= 600 && heard.speechMs <= 800, `got ${heard.speechMs} ms`);
});

test('listen streams one utterance and ends at the silence window', async () => {
  const listening = listen(runtime.runtimeStreams, { endSilenceMs: 300, noSpeechTimeoutMs: 2000, maxUtteranceMs: 10_000 });
  await sleep(30);
  for (let i = 0; i < 10; i++) mic.push(silenceFrame());
  for (let i = 0; i < 50; i++) mic.push(speechFrame()); // 1 s of speech
  for (let i = 0; i < 20; i++) mic.push(silenceFrame());
  for (let i = 0; i < 20; i++) mic.push(speechFrame()); // after the turn ended: not included
  const heard = await listening;
  assert.ok(heard.ok, heard.ok ? '' : heard.error);
  assert.ok(heard.speechMs >= 1300 && heard.speechMs <= 1500, `got ${heard.speechMs} ms`);
  assert.equal(heard.pcm.byteLength % 2, 0);
  assert.equal(heard.pcm.byteLength, (heard.speechMs * LISTEN_SAMPLE_RATE * 2) / 1000);
});

test('listen ends with zero bytes when the caller stays silent', async () => {
  for (let i = 0; i < 20; i++) mic.push(silenceFrame()); // clear any speech run
  const started = Date.now();
  const heard = await listen(runtime.runtimeStreams, { endSilenceMs: 300, noSpeechTimeoutMs: 400, maxUtteranceMs: 10_000 });
  assert.ok(heard.ok, heard.ok ? '' : heard.error);
  assert.equal(heard.pcm.byteLength, 0);
  assert.ok(Date.now() - started >= 400);
});

test('an unknown capability is refused, not hung', async () => {
  const opened = await runtime.runtimeStreams.open({ capability: 'livekit.video', timeoutMs: 2000 });
  assert.equal(opened.ok, false);
  assert.match(opened.ok ? '' : opened.error, /no "livekit.video" capability/);
});

test('a runtime abort mid-playback stops the speaker without crashing the host', async () => {
  let cleared = 0;
  const originalClear = speaker.clear;
  speaker.clear = () => void cleared++;
  try {
    const opened = await runtime.runtimeStreams.open({
      capability: CAPABILITY.speak,
      metadata: { protocol: 'sa-voice/0', format: 'pcm_s16le', sampleRate: 24_000, channels: 1, text: 'x', bargeIn: false },
    });
    assert.ok(opened.ok);
    const writer = opened.stream.writable.getWriter();
    await writer.write(new Uint8Array(9600)); // 200 ms
    await sleep(20);
    opened.stream.close('The runtime cancelled this reply.');
    const outcome = await opened.stream.closed;
    assert.equal(outcome.ok, false);
    await sleep(100);
    assert.ok(cleared >= 1, 'the speaker queue was cleared');
  } finally {
    speaker.clear = originalClear;
  }
});

test('a TTS failure aborts the stream and surfaces the error', async () => {
  const broken: TextToSpeech = {
    name: 'broken',
    async synthesize() {
      throw new Error('quota exceeded');
    },
  };
  const outcome = await speak(runtime.runtimeStreams, broken, 'Hi.', { bargeIn: true });
  assert.equal(outcome.ok, false);
  assert.match(outcome.ok ? '' : outcome.error, /quota exceeded/);
});
