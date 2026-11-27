import type { ThreadState } from '@standardagents/spec';
import {
  DEFAULT_TTS_INSTRUCTIONS,
  deepgramStt,
  deepgramTts,
  elevenlabsTts,
  openaiStt,
  openaiTts,
  type SpeechToText,
  type TextToSpeech,
} from './providers.js';

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
      `${name} is not set in the runtime (${why}). Set it as a runtime environment variable for this agent.`,
    );
  }
  return value;
}

/**
 * Build the STT and TTS clients from thread env.
 *
 * Providers come from VOICE_STT_PROVIDER (openai | deepgram) and
 * VOICE_TTS_PROVIDER (openai | elevenlabs | deepgram). The agent definition sets both to
 * openai; a thread env value overrides that per call.
 */
export async function loadVoiceConfig(state: ThreadState): Promise<VoiceConfig> {
  const sttProvider = (await optional(state, 'VOICE_STT_PROVIDER')) ?? 'openai';
  const ttsProvider = (await optional(state, 'VOICE_TTS_PROVIDER')) ?? 'openai';

  const language = await optional(state, 'VOICE_STT_LANGUAGE');
  const keyterms = ((await optional(state, 'VOICE_STT_KEYTERMS')) ?? '')
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);
  let stt: SpeechToText;
  switch (sttProvider) {
    case 'openai':
      stt = openaiStt(
        await required(state, 'OPENAI_API_KEY', 'speech to text'),
        (await optional(state, 'OPENAI_STT_MODEL')) ?? 'gpt-4o-mini-transcribe',
        language,
        keyterms,
      );
      break;
    case 'deepgram':
      stt = deepgramStt(
        await required(state, 'DEEPGRAM_API_KEY', 'speech to text'),
        (await optional(state, 'DEEPGRAM_MODEL')) ?? 'nova-3',
        language,
        keyterms,
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
        (await optional(state, 'OPENAI_TTS_INSTRUCTIONS')) ?? DEFAULT_TTS_INSTRUCTIONS,
      );
      break;
    case 'elevenlabs':
      tts = elevenlabsTts(
        await required(state, 'ELEVENLABS_API_KEY', 'text to speech'),
        (await optional(state, 'ELEVENLABS_MODEL')) ?? 'eleven_flash_v2_5',
        await required(state, 'ELEVENLABS_VOICE_ID', 'the ElevenLabs voice to speak with'),
      );
      break;
    case 'deepgram':
      tts = deepgramTts(
        await required(state, 'DEEPGRAM_API_KEY', 'text to speech'),
        (await optional(state, 'DEEPGRAM_TTS_MODEL')) ?? 'aura-2-thalia-en',
      );
      break;
    default:
      throw new Error(`Unknown VOICE_TTS_PROVIDER "${ttsProvider}". Use openai, elevenlabs, or deepgram.`);
  }

  return { stt, tts };
}
