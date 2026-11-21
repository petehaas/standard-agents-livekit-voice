import type { Message, ThreadState } from '@standardagents/spec';
import { heardPortion } from './audio.ts';
import { CALL_ENDED_KEY, NO_RESPONSE } from './call.ts';
import type { VoiceConfig } from './config.ts';
import { hangup, listen, speak } from './streams.ts';

const LISTEN = { endSilenceMs: 700, noSpeechTimeoutMs: 8_000, maxUtteranceMs: 30_000 };

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
  const text = message.role === 'assistant' ? (message.content ?? '').trim() : '';
  if (!text) return; // tool-call steps and empty messages are not spoken

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
  const spoken = await speak(streams, voice.tts, text, { bargeIn: true });
  if (!spoken.ok) {
    await endCall(state, `Could not speak into the room: ${spoken.error}`);
    return;
  }
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

  if (await state.getValue<boolean>(CALL_ENDED_KEY)) {
    await endCall(state, 'The caller said goodbye.');
    return;
  }

  // ── Listen ─────────────────────────────────────────────────────────────
  const heard = await listen(streams, LISTEN);
  if (!heard.ok) {
    await endCall(state, `Could not listen to the room: ${heard.error}`);
    return;
  }

  let transcript = '';
  let sttMs = 0;
  if (heard.pcm.byteLength > 0) {
    const started = Date.now();
    try {
      transcript = await voice.stt.transcribe(heard.pcm);
    } catch (error) {
      await endCall(state, `Speech to text failed: ${errorText(error)}`);
      return;
    }
    sttMs = Date.now() - started;
  }
  state.emit('voice_heard', { stt: voice.stt.name, speechMs: Math.round(heard.speechMs), sttMs, transcript });

  await state.injectMessage({
    role: 'user',
    content: transcript || NO_RESPONSE,
    metadata: {
      voice: { speechMs: Math.round(heard.speechMs), sttMs, interruptedPreviousReply: spoken.interrupted },
    },
  });
}
