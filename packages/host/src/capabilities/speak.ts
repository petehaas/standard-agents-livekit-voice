import {
  SPEAK_SAMPLE_RATE,
  VOICE_PROTOCOL,
  type SpeakMetadata,
  type SpeakReport,
} from '@petehaas/standard-agents-livekit-voice/protocol';
import type { HostStream } from '../bridge.js';
import { log } from '../log.js';
import { FRAME_MS, type MicTap } from '../mic.js';
import type { Presence } from '../aura.js';
import type { CallEvents, TurnClock } from '../events.js';

/** Where agent audio goes. In production this is a LiveKit AudioSource. */
export interface Speaker {
  play(samples: Int16Array, sampleRate: number): Promise<void>;
  /** Drop everything queued but not yet played. */
  clear(): void;
  /** Milliseconds captured but not yet played out. */
  queuedMs(): number;
  waitForPlayout(): Promise<void>;
}

export interface SpeakOptions {
  /** Caller speech must last this long to count as a barge-in. */
  bargeInMs: number;
  /** Turn barge-in off entirely, for example on a speakerphone without echo cancellation. */
  bargeInEnabled: boolean;
}

const FRAME_SAMPLES = (SPEAK_SAMPLE_RATE * 20) / 1000; // 20 ms at 24 kHz
const FRAME_BYTES = FRAME_SAMPLES * 2;
/**
 * Playback that must elapse before caller speech can interrupt.
 * Echo cancellation is still settling in the first moments of a reply,
 * and a speech run that started before the agent talked is not a barge-in.
 */
const BARGE_IN_GRACE_MS = 180;

function toSamples(bytes: Uint8Array): Int16Array {
  // Copy so the Int16Array is aligned and owns its memory.
  const copy = new Uint8Array(bytes.byteLength - (bytes.byteLength % 2));
  copy.set(bytes.subarray(0, copy.byteLength));
  return new Int16Array(copy.buffer);
}

/**
 * Serve `livekit.speak`: play the runtime's PCM into the room as it arrives.
 * Report how much the caller heard, then end the stream.
 */
export async function serveSpeak(
  stream: HostStream,
  speaker: Speaker,
  mic: MicTap,
  options: SpeakOptions,
  presence?: Presence,
  events?: CallEvents,
  clock?: TurnClock,
) {
  const meta = stream.metadata as Partial<SpeakMetadata>;
  if (meta.protocol !== VOICE_PROTOCOL) throw new Error(`Unsupported voice protocol ${String(meta.protocol)}.`);
  if (meta.sampleRate !== SPEAK_SAMPLE_RATE || meta.format !== 'pcm_s16le') {
    throw new Error(`Speak needs pcm_s16le at ${SPEAK_SAMPLE_RATE} Hz.`);
  }
  const bargeIn = options.bargeInEnabled && meta.bargeIn !== false;
  log.info('speak', `"${String(meta.text ?? '').slice(0, 90)}"`);
  presence?.set('speaking');
  let announced = false;
  const announce = () => {
    if (announced) return;
    announced = true;
    const latency = clock?.agentStarted();
    if (latency) {
      log.info('speak', `voice-to-voice ${latency.responseMs} ms`);
      events?.emit({ type: 'latency', ...latency });
    }
    if (meta.text) events?.emit({ type: 'caption', role: 'agent', text: String(meta.text).slice(0, 500) });
  };

  let capturedMs = 0;
  let interrupted = false;
  let heardMs = 0;
  let speechWhilePlayingMs = 0;
  let onInterrupt!: () => void;
  const interruptedSignal = new Promise<void>((resolve) => (onInterrupt = resolve));

  const unsubscribe = bargeIn
    ? mic.subscribe((frame) => {
        if (interrupted) return;
        // Count only speech that arrives after playback is underway.
        // mic.speechRunMs includes whatever was already happening when the
        // reply started, which is how a greeting used to die in under 200 ms.
        if (capturedMs < BARGE_IN_GRACE_MS || !frame.speech) {
          speechWhilePlayingMs = 0;
          return;
        }
        speechWhilePlayingMs += FRAME_MS;
        if (speechWhilePlayingMs < options.bargeInMs) return;
        interrupted = true;
        heardMs = Math.max(0, capturedMs - speaker.queuedMs());
        speaker.clear();
        mic.markTurnStart(); // the next listen starts from these words
        onInterrupt();
      })
    : () => {};

  // Feed PCM in 20 ms frames, carrying any partial frame across chunks.
  const playback = (async () => {
    let carry = new Uint8Array(0);
    for await (const chunk of stream.inbound) {
      if (interrupted) break;
      let bytes = chunk;
      if (carry.byteLength > 0) {
        bytes = new Uint8Array(carry.byteLength + chunk.byteLength);
        bytes.set(carry, 0);
        bytes.set(chunk, carry.byteLength);
      }
      let offset = 0;
      while (bytes.byteLength - offset >= FRAME_BYTES && !interrupted) {
        await speaker.play(toSamples(bytes.subarray(offset, offset + FRAME_BYTES)), SPEAK_SAMPLE_RATE);
        announce();
        capturedMs += 20;
        offset += FRAME_BYTES;
      }
      carry = bytes.slice(offset);
    }
    if (!interrupted && carry.byteLength >= 2) {
      const tail = toSamples(carry);
      await speaker.play(tail, SPEAK_SAMPLE_RATE);
      capturedMs += (tail.length / SPEAK_SAMPLE_RATE) * 1000;
    }
    if (!interrupted) await speaker.waitForPlayout();
  })();
  // After a barge-in the race below has settled; a later failure here is moot.
  playback.catch(() => {});

  // The runtime gave up on this reply (TTS failure, timeout). Stop talking now.
  const onAbort = () => speaker.clear();
  stream.aborted.addEventListener('abort', onAbort);

  try {
    await Promise.race([playback, interruptedSignal]);
  } catch (error) {
    if (stream.aborted.aborted) {
      log.warn('speak', `runtime aborted playback: ${(stream.aborted.reason as Error | undefined)?.message ?? 'no reason'}`);
      return;
    }
    throw error;
  } finally {
    unsubscribe();
    stream.aborted.removeEventListener('abort', onAbort);
    presence?.set('idle');
  }

  const report: SpeakReport = {
    event: 'played',
    playedMs: Math.round(interrupted ? heardMs : capturedMs),
    interrupted,
  };
  if (interrupted) events?.emit({ type: 'interrupted', heardMs: report.playedMs });
  log.info('speak', interrupted ? `barge-in after ${report.playedMs} ms` : `played ${report.playedMs} ms`);
  stream.write(new TextEncoder().encode(`${JSON.stringify(report)}\n`));
  // Returning ends the stream. If we were interrupted, the runtime's next
  // write fails, which cancels its TTS request.
}
