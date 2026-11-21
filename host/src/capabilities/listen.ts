import { LISTEN_SAMPLE_RATE, VOICE_PROTOCOL, type ListenMetadata } from '../../../agent/src/voice/protocol.ts';
import type { HostStream } from '../bridge.js';
import { log } from '../log.js';
import { FRAME_MS, framesToBytes, type MicTap } from '../mic.js';

export interface ListenOptions {
  /** Speech must last this long before a turn starts. Filters coughs and clicks. */
  minSpeechMs: number;
  /** Audio kept from before the detected start, so first syllables are not clipped. */
  prerollMs: number;
}

/** Send audio to the runtime in batches of this size, rather than one frame per message. */
const BATCH_MS = 100;

/**
 * Serve `livekit.listen`: stream the caller's next utterance to the runtime,
 * then end the stream. End with zero bytes if no speech starts in time.
 */
export async function serveListen(stream: HostStream, mic: MicTap, options: ListenOptions) {
  const meta = stream.metadata as Partial<ListenMetadata>;
  if (meta.protocol !== VOICE_PROTOCOL) throw new Error(`Unsupported voice protocol ${String(meta.protocol)}.`);
  if (meta.sampleRate !== LISTEN_SAMPLE_RATE || meta.format !== 'pcm_s16le') {
    throw new Error(`Listen needs pcm_s16le at ${LISTEN_SAMPLE_RATE} Hz.`);
  }
  const endSilenceMs = meta.endSilenceMs ?? 700;
  const noSpeechTimeoutMs = meta.noSpeechTimeoutMs ?? 8_000;
  const maxUtteranceMs = meta.maxUtteranceMs ?? 30_000;

  await new Promise<void>((resolve) => {
    let speaking = false;
    let utteranceMs = 0;
    let silenceMs = 0;
    let batch: Int16Array[] = [];
    let done = false;
    const deadline = Date.now() + noSpeechTimeoutMs;

    const flush = () => {
      if (batch.length === 0) return;
      stream.write(framesToBytes(batch));
      batch = [];
    };

    const finish = (why: string) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearInterval(timer);
      flush();
      log.info('listen', speaking ? `${why}: ${(utteranceMs / 1000).toFixed(1)} s of speech` : why);
      resolve();
    };

    const start = (lead = mic.recent(mic.speechRunMs + options.prerollMs)) => {
      speaking = true;
      // Include the speech that triggered the start plus a little before it.
      batch.push(...lead.map((frame) => frame.samples));
      utteranceMs = lead.length * FRAME_MS;
      log.info('listen', 'caller is speaking');
    };

    const unsubscribe = mic.subscribe((frame) => {
      if (done) return;
      if (!speaking) {
        if (mic.speechRunMs >= options.minSpeechMs) start();
        return;
      }
      batch.push(frame.samples);
      utteranceMs += FRAME_MS;
      silenceMs = frame.speech ? 0 : silenceMs + FRAME_MS;
      if (batch.length * FRAME_MS >= BATCH_MS) flush();
      if (silenceMs >= endSilenceMs) finish('end of turn');
      else if (utteranceMs >= maxUtteranceMs) finish('utterance limit');
    });

    const timer = setInterval(() => {
      if (!speaking && Date.now() > deadline) finish('no speech');
    }, 100);

    stream.aborted.addEventListener('abort', () => finish('runtime aborted'));

    // After a barge-in, the turn began while the agent was still talking.
    // Start from those interrupting words, even if the caller has paused since.
    const interruptingTurn = mic.takeTurnStart(options.prerollMs);
    if (interruptingTurn) start(interruptingTurn);
    else if (mic.speechRunMs >= options.minSpeechMs) start();
  });
}
