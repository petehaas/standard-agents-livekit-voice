/**
 * Speech providers, called from the Worker with plain fetch.
 *
 * STT and TTS run on the runtime side on purpose: the agent package owns its
 * vendor choices, the same way a Standard Agent owns its model choice. The
 * execution host only moves audio and never needs a provider key.
 */
import { pcmToWav } from './audio.js';
import { LISTEN_SAMPLE_RATE, SPEAK_SAMPLE_RATE } from './protocol.js';

export interface SpeechToText {
  readonly name: string;
  /** Transcribe mono s16le PCM at LISTEN_SAMPLE_RATE. */
  transcribe(pcm: Uint8Array): Promise<string>;
  /**
   * Optional live transcription. Audio is pushed while the caller is still
   * talking, so when their turn ends only the last fraction of a second is
   * left to transcribe. Callers fall back to `transcribe` if it fails.
   */
  stream?(): StreamingTranscription;
}

export interface StreamingTranscription {
  /** Send PCM as it arrives. Never throws; a failure surfaces from `finish`. */
  push(pcm: Uint8Array): void;
  /** No more audio. Resolves with the full transcript once the provider flushes. */
  finish(): Promise<string>;
  /** Drop the session without waiting for a result. */
  cancel(): void;
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

export function openaiStt(apiKey: string, model: string, language?: string, keyterms: string[] = []): SpeechToText {
  return {
    name: language ? `openai:${model}:${language}` : `openai:${model}`,
    async transcribe(pcm) {
      const form = new FormData();
      form.append('model', model);
      form.append('response_format', 'json');
      // Without this, a short or noisy clip is often transcribed as Chinese.
      if (language) form.append('language', language);
      // Words the recognizer would otherwise guess at. Short clips can come
      // back in another language even with language=en; a prompt anchors them.
      if (keyterms.length) form.append('prompt', `A phone call. Names and terms: ${keyterms.join(', ')}.`);
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

export function deepgramStt(apiKey: string, model: string, language?: string, keyterms: string[] = []): SpeechToText {
  // Nova-3 keyterm prompting boosts these words in both batch and live modes.
  const boost = (url: URL) => keyterms.forEach((term) => url.searchParams.append('keyterm', term));
  return {
    name: language ? `deepgram:${model}:${language}` : `deepgram:${model}`,
    async transcribe(pcm) {
      const url = new URL('https://api.deepgram.com/v1/listen');
      url.searchParams.set('model', model);
      url.searchParams.set('smart_format', 'true');
      if (language) url.searchParams.set('language', language);
      boost(url);
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
    stream() {
      const url = new URL('wss://api.deepgram.com/v1/listen');
      url.searchParams.set('model', model);
      url.searchParams.set('encoding', 'linear16');
      url.searchParams.set('sample_rate', String(LISTEN_SAMPLE_RATE));
      url.searchParams.set('channels', '1');
      url.searchParams.set('smart_format', 'true');
      if (language) url.searchParams.set('language', language);
      boost(url);
      return deepgramLive(url.toString(), apiKey, liveSocket);
    },
  };
}

/** How a live session opens its socket. Tests swap in a local server. */
export type LiveSocketFactory = (url: string, protocols: string[]) => WebSocket;
const liveSocket: LiveSocketFactory = (url, protocols) => new WebSocket(url, protocols);

/** Flush wait after CloseStream. Past this, the caller falls back to batch STT. */
const LIVE_FLUSH_TIMEOUT_MS = 2_500;

/**
 * One Deepgram live session. Opened lazily by the first push, so a listen
 * turn with no speech costs nothing, and the connect overlaps the caller's
 * first words instead of the end of their turn.
 */
export function deepgramLive(url: string, apiKey: string, open: LiveSocketFactory): StreamingTranscription {
  let socket: WebSocket | null = null;
  let failure: string | null = null;
  let closed = false;
  const pending: Uint8Array<ArrayBuffer>[] = [];
  const finals: string[] = [];
  let onClosed: () => void = () => {};
  const closedPromise = new Promise<void>((resolve) => (onClosed = resolve));

  const connect = () => {
    try {
      // Browser-style WebSockets cannot set headers; Deepgram accepts the key as a subprotocol.
      socket = open(url, ['token', apiKey]);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      closed = true;
      onClosed();
      return;
    }
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => {
      for (const chunk of pending.splice(0)) socket!.send(chunk);
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data) as {
          type?: string;
          is_final?: boolean;
          channel?: { alternatives?: { transcript?: string }[] };
        };
        if (msg.type === 'Results' && msg.is_final) {
          const text = msg.channel?.alternatives?.[0]?.transcript?.trim();
          if (text) finals.push(text);
        }
      } catch {
        // Ignore anything that is not JSON.
      }
    });
    socket.addEventListener('error', () => {
      failure ??= 'Deepgram live socket error';
    });
    socket.addEventListener('close', (event) => {
      if (event.code !== 1000 && event.code !== 1005) failure ??= `Deepgram live closed ${event.code} ${event.reason}`;
      closed = true;
      onClosed();
    });
  };

  return {
    push(pcm) {
      if (closed || pcm.byteLength === 0) return;
      if (!socket) connect();
      // Stream chunks are plain ArrayBuffer-backed; the cast only narrows the type.
      const chunk = pcm as Uint8Array<ArrayBuffer>;
      if (socket?.readyState === 1) socket.send(chunk);
      else if (!closed) pending.push(chunk);
    },
    async finish() {
      if (!socket) {
        if (failure) throw new Error(failure);
        return '';
      }
      const sendClose = () => {
        try {
          socket!.send(JSON.stringify({ type: 'CloseStream' }));
        } catch {
          // Already closing.
        }
      };
      if (socket.readyState === 1) sendClose();
      else socket.addEventListener('open', sendClose);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        closedPromise.then(() => false),
        new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), LIVE_FLUSH_TIMEOUT_MS))),
      ]);
      clearTimeout(timer);
      if (timedOut) {
        this.cancel();
        throw new Error('Deepgram live did not flush in time');
      }
      if (failure) throw new Error(failure);
      return finals.join(' ').trim();
    },
    cancel() {
      closed = true;
      pending.length = 0;
      try {
        socket?.close();
      } catch {
        // Ignore.
      }
      onClosed();
    },
  };
}



// ─── Text to speech ────────────────────────────────────────────────────────

/**
 * Delivery direction for steerable OpenAI voices (gpt-4o-mini-tts and later).
 * This is where most of the "expressive" comes from: same words, a warmer read.
 */
export const DEFAULT_TTS_INSTRUCTIONS =
  'Warm, friendly voice. Speak at a brisk, natural pace with real intonation. ' +
  'Never sound robotic or read like a script.';

export function openaiTts(apiKey: string, model: string, voice: string, instructions?: string): TextToSpeech {
  // tts-1 and tts-1-hd reject `instructions`.
  const steerable = !/^tts-1/.test(model);
  return {
    name: `openai:${model}:${voice}`,
    async synthesize(text, signal) {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        // `pcm` is raw 24 kHz, 16-bit, mono, little-endian.
        body: JSON.stringify({
          model,
          voice,
          input: text,
          response_format: 'pcm',
          ...(steerable && instructions ? { instructions } : {}),
        }),
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
        body: JSON.stringify({
          text,
          model_id: model,
          // Less stability = more expressive; a little style adds emotion without much latency.
          voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true },
        }),
        signal,
      });
      if (!response.ok) return failWith('ElevenLabs', response);
      if (!response.body) throw new Error('ElevenLabs returned no body.');
      return response.body;
    },
  };
}

/**
 * Deepgram Aura. Typically the lowest time-to-first-audio of the supported
 * providers, and it streams raw linear16 at the rate we ask for.
 */
export function deepgramTts(apiKey: string, model: string): TextToSpeech {
  return {
    name: `deepgram:${model}`,
    async synthesize(text, signal) {
      const url = new URL('https://api.deepgram.com/v1/speak');
      url.searchParams.set('model', model);
      url.searchParams.set('encoding', 'linear16');
      url.searchParams.set('sample_rate', String(SPEAK_SAMPLE_RATE));
      url.searchParams.set('container', 'none');
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal,
      });
      if (!response.ok) return failWith('Deepgram speak', response);
      if (!response.body) throw new Error('Deepgram speak returned no body.');
      return response.body;
    },
  };
}
