/**
 * `npm run probe`: check the runtime stream plumbing with no LiveKit, model,
 * or speech provider. It creates a stream_probe thread, attaches as its
 * execution host with a fake speaker and a synthetic caller, and prints what
 * the agent saw on each capability.
 */
import 'dotenv/config';
import { CAPABILITY } from '../../agent/src/voice/protocol.ts';
import { resolveToken } from './auth.js';
import { ExecutionHostBridge } from './bridge.js';
import { serveListen } from './capabilities/listen.js';
import { serveSpeak, type Speaker } from './capabilities/speak.js';
import { log } from './log.js';
import { FRAME_SAMPLES, MicTap } from './mic.js';
import { ThreadsApi } from './threads.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function noise(): Int16Array {
  const frame = new Int16Array(FRAME_SAMPLES);
  for (let i = 0; i < frame.length; i++) frame[i] = Math.round((Math.random() * 2 - 1) * 20);
  return frame;
}

function tone(amplitude: number): Int16Array {
  const frame = new Int16Array(FRAME_SAMPLES);
  for (let i = 0; i < frame.length; i++) frame[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / 16_000));
  return frame;
}

async function main() {
  const baseUrl = process.env.SA_BASE_URL ?? 'http://127.0.0.1:5173';
  const apiKey = await resolveToken(baseUrl);
  const api = new ThreadsApi(baseUrl, apiKey);
  const threadId = await api.createThread('stream_probe', { tags: ['probe'] });
  log.info('probe', `thread ${threadId}`);

  let playedSamples = 0;
  const speaker: Speaker = {
    play: async (samples) => {
      playedSamples += samples.length;
    },
    clear: () => {},
    queuedMs: () => 0,
    waitForPlayout: async () => {},
  };

  // A synthetic caller: quiet noise, and one second of "speech" when asked.
  const mic = new MicTap();
  let speechFrames = 0;
  const caller = setInterval(() => {
    mic.push(speechFrames-- > 0 ? tone(8000) : noise());
  }, 20);
  await sleep(1_000); // let the VAD learn the noise floor

  const bridge = new ExecutionHostBridge({
    baseUrl,
    apiKey,
    threadId,
    clientId: `probe-${threadId}`,
    clientName: 'Stream probe',
    clientKind: 'probe',
  });
  bridge
    .serve(CAPABILITY.speak, (stream) => serveSpeak(stream, speaker, mic, { bargeInEnabled: false, bargeInMs: 240 }))
    .serve(CAPABILITY.listen, (stream) => {
      setTimeout(() => (speechFrames = 50), 300);
      return serveListen(stream, mic, { minSpeechMs: 160, prerollMs: 300 });
    });
  await bridge.connect();
  await api.sendMessage(threadId, 'run the probe');

  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(500);
      const response = await fetch(new URL(`/api/threads/${threadId}/messages?limit=20`, baseUrl), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const body = (await response.json()) as { messages?: { role: string; content: string | null }[] };
      const reply = body.messages?.find((m) => m.role === 'assistant' && m.content?.startsWith('{'));
      if (reply?.content) {
        console.log('\nWhat the agent saw:\n' + JSON.stringify(JSON.parse(reply.content), null, 2));
        console.log(`\nThe host's speaker received ${Math.round(playedSamples / 24)} ms of audio.\n`);
        return;
      }
    }
    throw new Error('The probe agent did not reply within 30 seconds. Check the dev server terminal.');
  } finally {
    clearInterval(caller);
    await bridge.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    log.error('probe', error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
