/** Small audio helpers that run in the Worker. No dependencies. */

/** Wrap mono s16le PCM in a WAV container, for STT APIs that want a file. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  write(36, 'data');
  view.setUint32(40, pcm.byteLength, true);

  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/** Concatenate byte chunks into one buffer. */
export function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let size = 0;
  for (const chunk of chunks) size += chunk.byteLength;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Typical conversational speaking rate, used when the full audio length is unknown. */
const WORDS_PER_SECOND = 2.6;

/**
 * Estimate the part of a reply the caller heard before cutting it off.
 *
 * When TTS finished before the interruption we know the total audio length and
 * use the played fraction. Otherwise we fall back to a speaking-rate estimate.
 * Word-level timestamps from the TTS provider would make this exact.
 */
export function heardPortion(text: string, playedMs: number, totalMs?: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const heardWords =
    totalMs && totalMs > 0
      ? Math.round(words.length * Math.min(1, playedMs / totalMs))
      : Math.round((playedMs / 1000) * WORDS_PER_SECOND);
  return words.slice(0, Math.max(0, Math.min(words.length, heardWords))).join(' ');
}
