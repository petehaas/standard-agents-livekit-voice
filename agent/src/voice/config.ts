import type { ThreadState } from '@standardagents/spec';
import {
  deepgramStt,
  elevenlabsTts,
  openaiStt,
  openaiTts,
  type SpeechToText,
  type TextToSpeech,
} from './providers.ts';

export interface VoiceConfig {
  stt: SpeechToText;
  tts: TextToSpeech;
}

/** `state.env()` throws for a missing name. Optional settings read through this. */
async function optional(state: ThreadState, name: string): Promise<string | undefined> {
  try {
    const value = await state.env(name);
    return value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}

async function required(state: ThreadState, name: string, why: string): Promise<string> {
  const value = await optional(state, name);
  if (!value) {
    throw new Error(
      `Set ${name} (${why}). Add it as an instance variable in the Standard Agents admin UI, or pass it in the thread's env.`,
    );
  }
  return value;
}

/**
 * Build the STT and TTS clients from thread env.
 *
 * Providers come from VOICE_STT_PROVIDER (openai | deepgram) and
 * VOICE_TTS_PROVIDER (openai | elevenlabs). The agent definition sets both to
 * openai; a thread env value overrides that per call.
 */
export async function loadVoiceConfig(state: ThreadState): Promise<VoiceConfig> {
  const sttProvider = (await optional(state, 'VOICE_STT_PROVIDER')) ?? 'openai';
  const ttsProvider = (await optional(state, 'VOICE_TTS_PROVIDER')) ?? 'openai';

  let stt: SpeechToText;
  switch (sttProvider) {
    case 'openai':
      stt = openaiStt(
        await required(state, 'OPENAI_API_KEY', 'speech to text'),
        (await optional(state, 'OPENAI_STT_MODEL')) ?? 'gpt-4o-mini-transcribe',
      );
      break;
    case 'deepgram':
      stt = deepgramStt(
        await required(state, 'DEEPGRAM_API_KEY', 'speech to text'),
        (await optional(state, 'DEEPGRAM_MODEL')) ?? 'nova-3',
      );
      break;
    default:
      throw new Error(`Unknown VOICE_STT_PROVIDER "${sttProvider}". Use openai or deepgram.`);
  }

  let tts: TextToSpeech;
  switch (ttsProvider) {
    case 'openai':
      tts = openaiTts(
        await required(state, 'OPENAI_API_KEY', 'text to speech'),
        (await optional(state, 'OPENAI_TTS_MODEL')) ?? 'gpt-4o-mini-tts',
        (await optional(state, 'OPENAI_TTS_VOICE')) ?? 'coral',
      );
      break;
    case 'elevenlabs':
      tts = elevenlabsTts(
        await required(state, 'ELEVENLABS_API_KEY', 'text to speech'),
        (await optional(state, 'ELEVENLABS_MODEL')) ?? 'eleven_flash_v2_5',
        await required(state, 'ELEVENLABS_VOICE_ID', 'the ElevenLabs voice to speak with'),
      );
      break;
    default:
      throw new Error(`Unknown VOICE_TTS_PROVIDER "${ttsProvider}". Use openai or elevenlabs.`);
  }

  return { stt, tts };
}
