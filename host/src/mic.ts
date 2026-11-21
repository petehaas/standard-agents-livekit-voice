/**
 * The caller's microphone as a stream of fixed 20 ms frames at 16 kHz, each
 * classified by the VAD. A short ring buffer keeps recent audio so a turn can
 * include the speech that came just before it started (pre-roll), including
 * the words that interrupted the agent.
 */
import { EnergyVad, type VadOptions } from './vad.js';

export const MIC_SAMPLE_RATE = 16_000;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (MIC_SAMPLE_RATE * FRAME_MS) / 1000; // 320

export interface MicFrame {
  samples: Int16Array;
  /** Smoothed VAD decision: at least 2 of the last 3 frames were speech. */
  speech: boolean;
  db: number;
}

type Listener = (frame: MicFrame) => void;

export class MicTap {
  private readonly vad: EnergyVad;
  private readonly ring: MicFrame[] = [];
  private readonly ringFrames: number;
  private readonly listeners = new Set<Listener>();
  private carry = new Int16Array(0);
  private raw: boolean[] = [];
  /** Consecutive smoothed-speech milliseconds ending at the latest frame. */
  speechRunMs = 0;
  /** Total frames seen. */
  private frameCount = 0;
  /** Frame index where an interrupting turn began, set on barge-in. */
  private turnStartFrame: number | null = null;

  constructor(vadOptions?: VadOptions, ringMs = 2_000) {
    this.vad = new EnergyVad(vadOptions);
    this.ringFrames = Math.ceil(ringMs / FRAME_MS);
  }

  /** Feed 16 kHz mono samples of any length. */
  push(samples: Int16Array) {
    let input = samples;
    if (this.carry.length > 0) {
      input = new Int16Array(this.carry.length + samples.length);
      input.set(this.carry, 0);
      input.set(samples, this.carry.length);
    }
    let offset = 0;
    while (input.length - offset >= FRAME_SAMPLES) {
      this.frame(input.slice(offset, offset + FRAME_SAMPLES));
      offset += FRAME_SAMPLES;
    }
    this.carry = input.slice(offset);
  }

  private frame(samples: Int16Array) {
    const { speech: rawSpeech, db } = this.vad.process(samples);
    this.raw.push(rawSpeech);
    if (this.raw.length > 3) this.raw.shift();
    const speech = this.raw.filter(Boolean).length >= 2;
    this.speechRunMs = speech ? this.speechRunMs + FRAME_MS : 0;

    const frame: MicFrame = { samples, speech, db };
    this.ring.push(frame);
    if (this.ring.length > this.ringFrames) this.ring.shift();
    this.frameCount++;
    for (const listener of this.listeners) listener(frame);
  }

  /** Remember that the caller's turn began with the current speech run (a barge-in). */
  markTurnStart() {
    this.turnStartFrame = this.frameCount - Math.round(this.speechRunMs / FRAME_MS);
  }

  /**
   * Audio since the marked turn start, plus `prerollMs` before it, then clear
   * the mark. Null when there is no mark or it has aged out of the ring.
   */
  takeTurnStart(prerollMs: number): MicFrame[] | null {
    if (this.turnStartFrame === null) return null;
    const since = this.frameCount - this.turnStartFrame + Math.ceil(prerollMs / FRAME_MS);
    this.turnStartFrame = null;
    if (since > this.ring.length) return null;
    return this.ring.slice(this.ring.length - since);
  }

  /** The most recent `ms` of audio, oldest first. */
  recent(ms: number): MicFrame[] {
    const frames = Math.min(this.ring.length, Math.ceil(ms / FRAME_MS));
    return this.ring.slice(this.ring.length - frames);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get noiseFloorDb() {
    return this.vad.floorDb;
  }
}

/** Flatten int16 frames into little-endian bytes for the wire. */
export function framesToBytes(frames: Int16Array[]): Uint8Array {
  let samples = 0;
  for (const frame of frames) samples += frame.length;
  const out = new Int16Array(samples);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.length;
  }
  return new Uint8Array(out.buffer);
}
