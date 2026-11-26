/**
 * Runtime-side halves of the voice capabilities. Each function opens one
 * runtime stream to the execution host, moves bytes, and always closes the
 * stream before it returns.
 */
import type { RuntimeByteStream, RuntimeStreamErrorCode, RuntimeStreams } from '@standardagents/spec';
import { concatBytes } from './audio.ts';
import type { TextToSpeech } from './providers.ts';
import {
  bytesPerMs,
  CAPABILITY,
  LISTEN_SAMPLE_RATE,
  PCM_FORMAT,
  SPEAK_SAMPLE_RATE,
  VOICE_PROTOCOL,
  type CaptionMetadata,
  type HangupMetadata,
  type ListenMetadata,
  type ShowMetadata,
  type SpeakMetadata,
  type SpeakReport,
} from './protocol.ts';

export type StreamFailure = { ok: false; error: string; code?: RuntimeStreamErrorCode };

export type SpeakOutcome =
  | {
      ok: true;
      playedMs: number;
      /** Full audio length, known only when synthesis finished before playback stopped. */
      totalMs?: number;
      interrupted: boolean;
      /** Time from opening the stream to the first audio byte written. */
      firstAudioMs: number | null;
    }
  | StreamFailure;

export type ListenOutcome = { ok: true; pcm: Uint8Array; speechMs: number } | StreamFailure;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Read a readable side to the end. Resolves with what arrived, even if the stream errors. */
async function drain(
  readable: ReadableStream<Uint8Array>,
  onChunk?: (chunk: Uint8Array) => void,
): Promise<{ chunks: Uint8Array[]; error?: string }> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { chunks };
      chunks.push(value);
      onChunk?.(value);
    }
  } catch (error) {
    return { chunks, error: message(error) };
  } finally {
    reader.releaseLock();
  }
}

/** Close a stream after a deadline, so a silent host can never hang a turn. */
function guard(stream: RuntimeByteStream, ms: number, reason: string): () => void {
  const timer = setTimeout(() => stream.close(reason), ms);
  return () => clearTimeout(timer);
}

/**
 * Speak `text` into the room.
 *
 * TTS audio is piped to the host as it arrives, so playback starts before
 * synthesis ends. If the caller barges in, the host stops playback, reports
 * how much was heard, and ends the stream. Our next write then fails, which
 * is how the interruption cancels the TTS request upstream.
 */
export async function speak(
  streams: RuntimeStreams,
  tts: TextToSpeech,
  text: string,
  options: { bargeIn: boolean },
): Promise<SpeakOutcome> {
  const metadata: SpeakMetadata = {
    protocol: VOICE_PROTOCOL,
    format: PCM_FORMAT,
    sampleRate: SPEAK_SAMPLE_RATE,
    channels: 1,
    text,
    bargeIn: options.bargeIn,
  };
  const startedAt = Date.now();
  const opened = await streams.open({ capability: CAPABILITY.speak, metadata, timeoutMs: 15_000 });
  if (!opened.ok) return opened;
  const { stream } = opened;

  // Generous upper bound: ~150 ms per character of speech plus synthesis time.
  const release = guard(stream, 30_000 + text.length * 150, 'Speak timed out.');
  const abort = new AbortController();
  const progress = {
    bytesWritten: 0,
    firstAudioMs: null as number | null,
    synthesisDone: false,
    synthesisError: null as string | null,
    hostEnded: false,
  };

  const drained = drain(stream.readable).then((result) => {
    progress.hostEnded = true;
    return result;
  });

  const pump = (async () => {
    const writer = stream.writable.getWriter();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      reader = (await tts.synthesize(text, abort.signal)).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value.byteLength === 0) continue;
        await writer.write(value);
        if (progress.firstAudioMs === null) progress.firstAudioMs = Date.now() - startedAt;
        progress.bytesWritten += value.byteLength;
      }
      progress.synthesisDone = true;
      await writer.close();
    } catch (error) {
      abort.abort();
      await reader?.cancel().catch(() => {});
      // A write that fails because the host already ended the stream is a
      // barge-in, not a TTS failure. Give the host's end a moment to land.
      await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, 250))]);
      if (!progress.hostEnded) {
        progress.synthesisError = message(error);
        stream.close(`TTS failed: ${progress.synthesisError}`);
      }
    } finally {
      writer.releaseLock();
    }
  })();

  try {
    const [{ chunks }] = await Promise.all([drained, pump]);
    const outcome = await stream.closed;
    if (progress.synthesisError !== null) {
      return { ok: false, error: `TTS (${tts.name}) failed: ${progress.synthesisError}` };
    }

    const report = parseReport(chunks);
    if (!report) {
      return { ok: false, error: outcome.error ?? 'The host ended the speak stream without a playback report.' };
    }
    const totalMs = progress.synthesisDone ? progress.bytesWritten / bytesPerMs(SPEAK_SAMPLE_RATE) : undefined;
    return {
      ok: true,
      playedMs: report.playedMs,
      totalMs,
      interrupted: report.interrupted,
      firstAudioMs: progress.firstAudioMs,
    };
  } finally {
    release();
    stream.close();
  }
}

function parseReport(chunks: Uint8Array[]): SpeakReport | null {
  const lines = new TextDecoder().decode(concatBytes(chunks)).split('\n').filter((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as Partial<SpeakReport>;
      if (parsed.event === 'played' && typeof parsed.playedMs === 'number') {
        return { event: 'played', playedMs: parsed.playedMs, interrupted: parsed.interrupted === true };
      }
    } catch {
      // Not a report line.
    }
  }
  return null;
}

/**
 * Wait for the caller's next utterance and return it as 16 kHz PCM.
 *
 * The host decides where the turn ends (voice activity plus a silence
 * window) and ends the stream. Zero bytes means the caller said nothing
 * before `noSpeechTimeoutMs`.
 */
export async function listen(
  streams: RuntimeStreams,
  options: Pick<ListenMetadata, 'endSilenceMs' | 'noSpeechTimeoutMs' | 'maxUtteranceMs'>,
  /** Called with each audio chunk as it arrives, for live transcription. */
  onAudio?: (pcm: Uint8Array) => void,
): Promise<ListenOutcome> {
  const metadata: ListenMetadata = {
    protocol: VOICE_PROTOCOL,
    format: PCM_FORMAT,
    sampleRate: LISTEN_SAMPLE_RATE,
    channels: 1,
    ...options,
  };
  const opened = await streams.open({ capability: CAPABILITY.listen, metadata, timeoutMs: 15_000 });
  if (!opened.ok) return opened;
  const { stream } = opened;
  const release = guard(
    stream,
    options.noSpeechTimeoutMs + options.maxUtteranceMs + 10_000,
    'Listen timed out.',
  );
  try {
    const { chunks, error } = await drain(stream.readable, onAudio);
    const outcome = await stream.closed;
    if (error || !outcome.ok) return { ok: false, error: outcome.error ?? error ?? 'The listen stream failed.' };
    const pcm = concatBytes(chunks);
    return { ok: true, pcm, speechMs: pcm.byteLength / bytesPerMs(LISTEN_SAMPLE_RATE) };
  } finally {
    release();
    stream.close();
  }
}

/**
 * Ask the host to put an order card on the caller's screen.
 * The host performs the LiveKit RPC; this side only sends the card.
 */
export async function showCard(
  streams: RuntimeStreams,
  card: Record<string, unknown>,
): Promise<{ ok: true } | StreamFailure> {
  const metadata: ShowMetadata = { protocol: VOICE_PROTOCOL, card };
  const opened = await streams.open({ capability: CAPABILITY.show, metadata, timeoutMs: 8_000 });
  if (!opened.ok) return opened;
  const { stream } = opened;
  try {
    const { error } = await drain(stream.readable);
    const outcome = await stream.closed;
    if (error || !outcome.ok) return { ok: false, error: outcome.error ?? error ?? 'The screen did not update.' };
    return { ok: true };
  } finally {
    stream.close();
  }
}

/** Ask the host to leave the room after any queued audio has played. */
export async function hangup(streams: RuntimeStreams, reason: string): Promise<void> {
  const metadata: HangupMetadata = { protocol: VOICE_PROTOCOL, reason };
  const opened = await streams.open({ capability: CAPABILITY.hangup, metadata, timeoutMs: 5_000 });
  if (!opened.ok) return;
  try {
    await drain(opened.stream.readable);
  } finally {
    opened.stream.close();
  }
}

/** Put the caller's transcript on their screen. Failures are ignored: captions are cosmetic. */
export async function caption(
  streams: RuntimeStreams,
  text: string,
  sttMs?: number,
): Promise<void> {
  const metadata: CaptionMetadata = { protocol: VOICE_PROTOCOL, role: 'caller', text, sttMs };
  const opened = await streams.open({ capability: CAPABILITY.caption, metadata, timeoutMs: 3_000 }).catch(() => null);
  if (!opened?.ok) return;
  try {
    await drain(opened.stream.readable);
  } finally {
    opened.stream.close();
  }
}
