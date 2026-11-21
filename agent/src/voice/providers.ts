/**
 * Speech providers, called from the Worker with plain fetch.
 *
 * STT and TTS run on the runtime side on purpose: the agent package owns its
 * vendor choices, the same way a Standard Agent owns its model choice. The
 * execution host only moves audio and never needs a provider key.
 */
import { pcmToWav } from './audio.ts';
import { LISTEN_SAMPLE_RATE } from './protocol.ts';

export interface SpeechToText {
  readonly name: string;
  /** Transcribe mono s16le PCM at LISTEN_SAMPLE_RATE. */
  transcribe(pcm: Uint8Array): Promise<string>;
}

export interface TextToSpeech {
  readonly name: string;
  /** Stream mono s16le PCM at SPEAK_SAMPLE_RATE. */
  synthesize(text: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

async function failWith(provider: string, response: Response): Promise<never> {
  const body = await response.text().catch(() => '');
  throw new Error(`${provider} returned ${response.status}: ${body.slice(0, 300)}`);
}

// ─── Speech to text ────────────────────────────────────────────────────────

export function openaiStt(apiKey: string, model: string): SpeechToText {
  return {
    name: `openai:${model}`,
    async transcribe(pcm) {
      const form = new FormData();
      form.append('model', model);
      form.append('response_format', 'json');
      form.append('file', new Blob([pcmToWav(pcm, LISTEN_SAMPLE_RATE)], { type: 'audio/wav' }), 'utterance.wav');
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!response.ok) return failWith('OpenAI transcription', response);
      const json = (await response.json()) as { text?: string };
      return (json.text ?? '').trim();
    },
  };
}

export function deepgramStt(apiKey: string, model: string): SpeechToText {
  return {
    name: `deepgram:${model}`,
    async transcribe(pcm) {
      const url = new URL('https://api.deepgram.com/v1/listen');
      url.searchParams.set('model', model);
      url.searchParams.set('smart_format', 'true');
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'audio/wav' },
        body: pcmToWav(pcm, LISTEN_SAMPLE_RATE),
      });
      if (!response.ok) return failWith('Deepgram', response);
      const json = (await response.json()) as {
        results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
      };
      return (json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();
    },
  };
}

// ─── Text to speech ────────────────────────────────────────────────────────

export function openaiTts(apiKey: string, model: string, voice: string): TextToSpeech {
  return {
    name: `openai:${model}:${voice}`,
    async synthesize(text, signal) {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        // `pcm` is raw 24 kHz, 16-bit, mono, little-endian.
        body: JSON.stringify({ model, voice, input: text, response_format: 'pcm' }),
        signal,
      });
      if (!response.ok) return failWith('OpenAI speech', response);
      if (!response.body) throw new Error('OpenAI speech returned no body.');
      return response.body;
    },
  };
}

export function elevenlabsTts(apiKey: string, model: string, voiceId: string): TextToSpeech {
  return {
    name: `elevenlabs:${model}:${voiceId}`,
    async synthesize(text, signal) {
      const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`);
      url.searchParams.set('output_format', 'pcm_24000');
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: model }),
        signal,
      });
      if (!response.ok) return failWith('ElevenLabs', response);
      if (!response.body) throw new Error('ElevenLabs returned no body.');
      return response.body;
    },
  };
}
