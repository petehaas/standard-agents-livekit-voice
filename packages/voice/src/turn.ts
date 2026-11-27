import type { Message, ThreadState } from '@standardagents/spec';
import { heardPortion } from './audio.js';
import { CALL_ENDED_KEY, NO_RESPONSE, UNINTELLIGIBLE } from './call.js';
import type { VoiceConfig } from './config.js';
import { caption, hangup, listen, speak } from './streams.js';

const LISTEN = { endSilenceMs: 400, noSpeechTimeoutMs: 8_000, maxUtteranceMs: 30_000 };
/** After a trailing "and…", wait this long for the rest before answering what we have. */
const CONTINUE_LISTEN = { endSilenceMs: 400, noSpeechTimeoutMs: 2_000, maxUtteranceMs: 30_000 };
const MAX_CONTINUATIONS = 2;

/**
 * Words that rarely end a finished thought. A transcript ending on one of
 * these means the caller paused mid-sentence. Deliberately short: a false
 * positive costs up to two seconds of extra waiting.
 */
const TRAILING_WORDS = new Set([
  'and', 'but', 'or', 'so', 'because', 'cause', 'then', 'also', 'plus',
  'the', 'a', 'an', 'my', 'your', 'to', 'of', 'for', 'with', 'about',
  'um', 'uh', 'umm', 'uhh', 'er', 'erm', 'hmm',
]);

export function soundsUnfinished(transcript: string): boolean {
  const text = transcript.trim().toLowerCase();
  if (!text) return false;
  if (/(\.\.\.|…|,|-|—)$/.test(text)) return true;
  // Questions are complete even if the last word is on the list ("what's it for?").
  if (text.endsWith('?')) return false;
  const last = text.replace(/[.!]+$/, '').split(/\s+/).pop() ?? '';
  return TRAILING_WORDS.has(last);
}

type Heard =
  | { ok: true; transcript: string; sttMs: number; sttMode: 'live' | 'batch' | 'none'; speechMs: number; hadAudio: boolean }
  | { ok: false; error: string };

/** Listen for one utterance and transcribe it, live when the provider can. */
async function hearUtterance(
  streams: NonNullable<ThreadState['runtimeStreams']>,
  voice: VoiceConfig,
  options: typeof LISTEN,
): Promise<Heard> {
  // With a streaming STT, audio is transcribed while the caller is still
  // talking, so the end of their turn leaves only a short flush to wait for.
  const live = voice.stt.stream?.();
  const heard = await listen(streams, options, live ? (pcm) => live.push(pcm) : undefined);
  if (!heard.ok) {
    live?.cancel();
    return { ok: false, error: `Could not listen to the room: ${heard.error}` };
  }
  if (heard.pcm.byteLength === 0) {
    live?.cancel();
    return { ok: true, transcript: '', sttMs: 0, sttMode: 'none', speechMs: 0, hadAudio: false };
  }
  const started = Date.now();
  let transcript = '';
  let sttMode: 'live' | 'batch' = 'batch';
  let liveOk = false;
  if (live) {
    try {
      transcript = await live.finish();
      sttMode = 'live';
      liveOk = true;
    } catch (error) {
      console.warn(`[voice] live STT failed, using batch: ${errorText(error)}`);
    }
  }
  if (!liveOk) {
    try {
      transcript = await voice.stt.transcribe(heard.pcm);
    } catch (error) {
      return { ok: false, error: `Speech to text failed: ${errorText(error)}` };
    }
  }
  return { ok: true, transcript, sttMs: Date.now() - started, sttMode, speechMs: heard.speechMs, hadAudio: true };
}

/**
 * The reply model occasionally emits its whole reply twice back to back
 * ("Say it again.Say it again."). Speaking that doubles the wait and sounds broken.
 */
export function collapseRepeat(text: string): string {
  const half = text.length / 2;
  if (Number.isInteger(half) && half > 8 && text.slice(0, half) === text.slice(half)) return text.slice(0, half).trim();
  return text;
}

export function hasToolCalls(message: Pick<Message, 'tool_calls'>): boolean {
  const calls = message.tool_calls;
  if (!calls) return false;
  try {
    const parsed: unknown = JSON.parse(calls);
    return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed);
  } catch {
    return calls.trim().length > 0;
  }
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * True when `reply` only repeats what the agent said in its previous message,
 * as in a preamble "Hi! What's your order number?" followed by a rejected tool
 * call and then "What's your order number?". The caller should hear it once.
 */
export function repeatsPrevious(reply: string, previous: string | undefined): boolean {
  if (!previous) return false;
  const now = normalize(reply);
  return now.length > 0 && normalize(previous).includes(now);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function endCall(state: ThreadState, reason: string) {
  await state.setValue(CALL_ENDED_KEY, true);
  if (state.runtimeStreams) await hangup(state.runtimeStreams, reason);
  await state.stopSession({ result: reason });
}

/**
 * One turn of the caller's side: speak side A's reply, then listen for the
 * caller's answer and inject its transcript as side B's message.
 *
 * `loadVoice` supplies STT and TTS, so tests can run the same turn logic
 * with fake providers.
 */
export async function runVoiceTurn(
  state: ThreadState,
  message: Message,
  loadVoice: (state: ThreadState) => Promise<VoiceConfig>,
): Promise<void> {
  const raw = message.role === 'assistant' ? (message.content ?? '').trim() : '';
  if (!raw) return; // tool-call steps and empty messages are not spoken
  const text = collapseRepeat(raw);
  if (text !== raw) {
    console.warn('[voice] reply was duplicated by the model; speaking it once');
    await state.updateMessage(message.id, { content: text, metadata: { voice: { collapsedRepeat: true } } });
  }

  const streams = state.runtimeStreams;
  if (!streams) {
    await state.stopSession({ result: 'This runtime has no runtime streams, so the voice side cannot run.' });
    return;
  }

  let voice: VoiceConfig;
  try {
    voice = await loadVoice(state);
  } catch (error) {
    await endCall(state, errorText(error));
    return;
  }

  // ── Speak ──────────────────────────────────────────────────────────────
  // A reply that only repeats the preamble the caller just heard (no caller
  // words in between) is not spoken again. Its turn still listens.
  const { messages: recent } = await state.getMessages({ limit: 6, order: 'desc' });
  const since = recent.filter((m) => m.id !== message.id);
  const lastCaller = since.findIndex((m) => m.role === 'user');
  const previous = since.find((m, i) => m.role === 'assistant' && m.content?.trim() && (lastCaller < 0 || i < lastCaller));
  let spoken: Awaited<ReturnType<typeof speak>>;
  if (repeatsPrevious(text, previous?.content ?? undefined)) {
    console.info('[voice] reply repeats the preamble the caller just heard; not speaking it twice');
    spoken = { ok: true, playedMs: 0, interrupted: false, firstAudioMs: null };
  } else {
    spoken = await speak(streams, voice.tts, text, { bargeIn: true });
  }
  if (!spoken.ok) {
    await endCall(state, `Could not speak into the room: ${spoken.error}`);
    return;
  }
  console.info(
    `[voice] spoke, first audio ${spoken.firstAudioMs ?? 'n/a'}ms, played ${Math.round(spoken.playedMs)}ms`,
  );
  state.emit('voice_spoke', {
    tts: voice.tts.name,
    firstAudioMs: spoken.firstAudioMs,
    playedMs: Math.round(spoken.playedMs),
    interrupted: spoken.interrupted,
  });

  // The caller cut the reply short. Keep only what they heard in history,
  // so the model doesn't believe it said things the caller never heard.
  if (spoken.interrupted) {
    const heard = heardPortion(text, spoken.playedMs, spoken.totalMs);
    await state.updateMessage(message.id, {
      content: heard ? `${heard} —` : '—',
      metadata: { voice: { interrupted: true, fullText: text, playedMs: Math.round(spoken.playedMs) } },
    });
  }

  // Words written alongside a tool call ("Let me check that.") are a preamble:
  // the model is still working and will write the real reply next. Speak it,
  // but do not listen, or the caller's answer races the reply and lands as two
  // separate messages.
  if (hasToolCalls(message)) return;

  if (await state.getValue<boolean>(CALL_ENDED_KEY)) {
    await endCall(state, 'The caller said goodbye.');
    return;
  }

  // ── Listen ─────────────────────────────────────────────────────────────
  let heardOnce = await hearUtterance(streams, voice, LISTEN);
  if (!heardOnce.ok) {
    await endCall(state, heardOnce.error);
    return;
  }
  let { transcript, sttMs, sttMode, speechMs, hadAudio } = heardOnce;

  // A short silence ends the host's turn, but "Okay. And…" is a pause, not an
  // answer. When the words trail off, keep listening and join the next part.
  for (let extra = 0; extra < MAX_CONTINUATIONS && soundsUnfinished(transcript); extra++) {
    console.info(`[voice] ${JSON.stringify(transcript)} sounds unfinished; listening on`);
    const more = await hearUtterance(streams, voice, CONTINUE_LISTEN);
    if (!more.ok) {
      await endCall(state, more.error);
      return;
    }
    if (!more.transcript) break; // they really were done
    transcript = `${transcript} ${more.transcript}`;
    sttMs = more.sttMs; // only the last flush adds to the wait after they stop
    speechMs += more.speechMs;
    sttMode = more.sttMode;
  }

  console.info(`[voice] heard ${JSON.stringify(transcript || '')} in ${sttMs}ms (${sttMode})`);
  state.emit('voice_heard', {
    stt: voice.stt.name,
    sttMode,
    speechMs: Math.round(speechMs),
    sttMs,
    transcript,
  });

  // Show the caller their words while the reply is being written. Not awaited
  // before the inject, so captions never add to the turn's latency.
  const captioned = transcript ? caption(streams, transcript, sttMs).catch(() => {}) : Promise.resolve();

  await state.injectMessage({
    role: 'user',
    content: transcript || (hadAudio ? UNINTELLIGIBLE : NO_RESPONSE),
    metadata: {
      voice: { speechMs: Math.round(speechMs), sttMs, interruptedPreviousReply: spoken.interrupted },
    },
  });
  await captioned;
}
