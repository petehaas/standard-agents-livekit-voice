import { LISTEN_SAMPLE_RATE, VOICE_PROTOCOL, type ListenMetadata } from '@petehaas/standard-agents-livekit-voice/protocol';
import type { HostStream } from '../bridge.js';
import { log } from '../log.js';
import { FRAME_MS, framesToBytes, type MicTap } from '../mic.js';
import type { Presence } from '../aura.js';
import type { TurnClock } from '../events.js';

export interface ListenOptions {
  /** Speech must last this long before a turn starts. Filters coughs and clicks. */
  minSpeechMs: number;
  /** Audio kept from before the detected start, so first syllables are not clipped. */
  prerollMs: number;
}

/** Send audio to the runtime in batches of this size, rather than one frame per message. */
const BATCH_MS = 100;
/**
 * A burst shorter than this is a click or a bark, not a turn. Drop it and
 * keep listening. Real replies, including a short name, run longer.
 */
const FALSE_START_MS = 240;

/**
 * Serve `livekit.listen`: stream the caller's next utterance to the runtime,
 * then end the stream. End with zero bytes if no speech starts in time.
 */
export async function serveListen(
  stream: HostStream,
  mic: MicTap,
  options: ListenOptions,
  presence?: Presence,
  clock?: TurnClock,
) {
  const meta = stream.metadata as Partial<ListenMetadata>;
  if (meta.protocol !== VOICE_PROTOCOL) throw new Error(`Unsupported voice protocol ${String(meta.protocol)}.`);
  if (meta.sampleRate !== LISTEN_SAMPLE_RATE || meta.format !== 'pcm_s16le') {
    throw new Error(`Listen needs pcm_s16le at ${LISTEN_SAMPLE_RATE} Hz.`);
  }
  const endSilenceMs = meta.endSilenceMs ?? 700;
  const noSpeechTimeoutMs = meta.noSpeechTimeoutMs ?? 8_000;
  const maxUtteranceMs = meta.maxUtteranceMs ?? 30_000;

  presence?.set('listening');
  await new Promise<void>((resolve) => {
    let speaking = false;
    let utteranceMs = 0;
    let speechMs = 0;
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
      // Speech is in. Stay visibly busy while the reply is transcribed and written.
      presence?.set(speechMs > 0 ? 'thinking' : 'idle');
      clock?.callerFinished();
      log.info('listen', speaking ? `${why}: ${(speechMs / 1000).toFixed(1)} s of speech` : why);
      resolve();
    };

    const start = (lead = mic.recent(mic.speechRunMs + options.prerollMs)) => {
      speaking = true;
      // Include the speech that triggered the start plus a little before it.
      batch.push(...lead.map((frame) => frame.samples));
      utteranceMs = lead.length * FRAME_MS;
      speechMs = lead.reduce((ms, frame) => ms + (frame.speech ? FRAME_MS : 0), 0);
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
      if (frame.speech) speechMs += FRAME_MS;
      silenceMs = frame.speech ? 0 : silenceMs + FRAME_MS;
      if (batch.length * FRAME_MS >= BATCH_MS && speechMs >= FALSE_START_MS) flush();
      if (silenceMs >= endSilenceMs) {
        if (speechMs < FALSE_START_MS) {
          speaking = false;
          utteranceMs = 0;
          speechMs = 0;
          silenceMs = 0;
          batch = [];
          log.info('listen', 'ignored a short noise burst');
          return;
        }
        finish('end of turn');
      } else if (utteranceMs >= maxUtteranceMs) finish('utterance limit');
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
