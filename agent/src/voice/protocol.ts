/**
 * The voice capability contract between the agent (runtime side) and the
 * LiveKit execution host. Both sides import this file, so it is the single
 * source of truth for capability names, metadata, and audio formats.
 *
 * Every capability is opened with `state.runtimeStreams.open()`. The Standard
 * Agent Specification treats capability names and metadata as opaque, so this
 * contract is ours to define. It is a candidate shape for a spec-level voice
 * capability.
 */

/** Version tag sent in every metadata object, so either side can refuse a mismatch. */
export const VOICE_PROTOCOL = 'sa-voice/0';

export const CAPABILITY = {
  /** Runtime writes PCM; the host plays it into the room. */
  speak: 'livekit.speak',
  /** The host writes the caller's next utterance as PCM; the runtime reads it. */
  listen: 'livekit.listen',
  /** The host leaves the room once queued audio has played. */
  hangup: 'livekit.hangup',
} as const;

/** All audio on the wire is signed 16-bit little-endian, mono. */
export const PCM_FORMAT = 'pcm_s16le' as const;

/** TTS output rate. OpenAI `pcm` and ElevenLabs `pcm_24000` both produce this. */
export const SPEAK_SAMPLE_RATE = 24_000;

/** STT input rate. Plenty for speech, and half the bytes of 32 kHz. */
export const LISTEN_SAMPLE_RATE = 16_000;

export type SpeakMetadata = {
  protocol: typeof VOICE_PROTOCOL;
  format: typeof PCM_FORMAT;
  sampleRate: number;
  channels: 1;
  /** The text being spoken, for host-side captions and logs. */
  text: string;
  /** When true, caller speech during playback stops it. */
  bargeIn: boolean;
};

/**
 * Sent by the host on the speak stream's readable side as one NDJSON line,
 * just before it ends the stream.
 */
export type SpeakReport = {
  event: 'played';
  /** Milliseconds of audio the caller actually heard. */
  playedMs: number;
  /** True when caller speech cut playback short. */
  interrupted: boolean;
};

export type ListenMetadata = {
  protocol: typeof VOICE_PROTOCOL;
  format: typeof PCM_FORMAT;
  sampleRate: number;
  channels: 1;
  /** End the turn after this much silence following speech. */
  endSilenceMs: number;
  /** Give up when no speech starts within this time. The stream then ends with zero bytes. */
  noSpeechTimeoutMs: number;
  /** Hard cap on one utterance. */
  maxUtteranceMs: number;
};

export type HangupMetadata = {
  protocol: typeof VOICE_PROTOCOL;
  reason: string;
};

/** Bytes per millisecond of mono s16le audio at a given rate. */
export function bytesPerMs(sampleRate: number): number {
  return (sampleRate * 2) / 1000;
}
