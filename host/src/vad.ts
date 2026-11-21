/**
 * An energy-based voice activity detector with an adaptive noise floor.
 *
 * It is deliberately simple and dependency-free, so the demo runs anywhere.
 * For production, swap in Silero VAD or LiveKit's turn-detector model; the
 * capability handlers only consume the per-frame `speech` boolean.
 */
export interface VadOptions {
  /** Speech must be this many dB above the noise floor. */
  marginDb: number;
  /** Never treat audio quieter than this as speech, whatever the floor. */
  minSpeechDb: number;
}

export const DEFAULT_VAD: VadOptions = { marginDb: 12, minSpeechDb: -48 };

/** RMS level of an int16 frame in dBFS. Silence returns -100. */
export function frameDb(samples: Int16Array): number {
  if (samples.length === 0) return -100;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] / 32768;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

export class EnergyVad {
  private noiseFloorDb = -60;
  private frames = 0;

  constructor(private readonly options: VadOptions = DEFAULT_VAD) {}

  /** Classify one frame. Call with consecutive frames of equal length. */
  process(samples: Int16Array): { speech: boolean; db: number; thresholdDb: number } {
    const db = frameDb(samples);
    const thresholdDb = Math.max(this.noiseFloorDb + this.options.marginDb, this.options.minSpeechDb);
    const speech = db > thresholdDb;

    // Track the floor quickly downward and slowly upward, and only from
    // non-speech frames, so a long utterance never raises its own threshold.
    this.frames++;
    if (!speech) {
      const rate = db < this.noiseFloorDb ? 0.2 : this.frames < 50 ? 0.1 : 0.02;
      this.noiseFloorDb += (db - this.noiseFloorDb) * rate;
    }
    return { speech, db, thresholdDb };
  }

  get floorDb() {
    return this.noiseFloorDb;
  }
}
