/**
 * A square frame of light published as the agent's camera. There is no face.
 * Idle, listening, thinking, and speaking only change how the orb breathes.
 */

export const AURA_SIZE = 640;

export type PresenceMode = 'idle' | 'speaking' | 'listening' | 'thinking';

export interface Presence {
  set(mode: PresenceMode): void;
}

export class AgentPresence implements Presence {
  mode: PresenceMode = 'idle';
  set(mode: PresenceMode) {
    this.mode = mode;
  }
}

type Rgb = [number, number, number];

const IDLE = { core: [186, 198, 235] as Rgb, aura: [72, 84, 150] as Rgb, speed: 0.14, breath: 0.08 };
const LISTENING = { core: [198, 236, 242] as Rgb, aura: [48, 150, 168] as Rgb, speed: 0.26, breath: 0.16 };
const THINKING = { core: [214, 206, 255] as Rgb, aura: [110, 96, 196] as Rgb, speed: 0.5, breath: 0.28 };
const SPEAKING = { core: [255, 236, 214] as Rgb, aura: [232, 128, 64] as Rgb, speed: 0.62, breath: 0.4 };

export class AuraFrames {
  readonly buffer: Uint8Array;
  private readonly dist: Float32Array;
  private readonly highlight: Float32Array;

  constructor(readonly size = AURA_SIZE) {
    this.buffer = new Uint8Array(size * size * 4);
    this.dist = new Float32Array(size * size);
    this.highlight = new Float32Array(size * size);
    const c = (size - 1) / 2;
    let i = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        this.dist[i] = Math.hypot(x - c, y - c);
        this.highlight[i] = Math.hypot(x - (c - size * 0.045), y - (c - size * 0.06));
        i++;
      }
    }
  }

  /** Draw into `buffer` and return it. The returned array is reused next call. */
  render(mode: PresenceMode, phase: number): Uint8Array {
    const look = mode === 'speaking' ? SPEAKING : mode === 'listening' ? LISTENING : mode === 'thinking' ? THINKING : IDLE;
    const pulse = Math.sin(phase * look.speed);
    const coreSigma = this.size * (0.09 + look.breath * 0.045 * pulse);
    const auraSigma = this.size * (0.24 + look.breath * 0.1 * (0.5 + 0.5 * pulse));
    const coreGain = mode === 'speaking' ? 1.15 : mode === 'thinking' ? 1 : mode === 'listening' ? 0.9 : 0.7;
    const auraGain =
      mode === 'speaking' ? 0.85 + 0.25 * pulse : mode === 'thinking' ? 0.62 + 0.22 * pulse : mode === 'listening' ? 0.55 : 0.36;
    const ringR = mode === 'speaking' ? this.size * (0.16 + ((phase % 22) / 22) * 0.28) : 0;
    const ringAmp = mode === 'speaking' ? (1 - (phase % 22) / 22) * 0.7 : 0;
    const data = this.buffer;
    const n = this.size * this.size;
    for (let i = 0; i < n; i++) {
      const d = this.dist[i];
      const aura = Math.exp(-(d * d) / (auraSigma * auraSigma));
      const core = Math.exp(-(d * d) / (coreSigma * coreSigma));
      const sheen = Math.exp(-(this.highlight[i] * this.highlight[i]) / ((this.size * 0.055) ** 2));
      const hot = Math.exp(-(d * d) / ((this.size * 0.04) ** 2));
      const ring = ringAmp === 0 ? 0 : ringAmp * Math.exp(-((d - ringR) * (d - ringR)) / 80);
      let r = 5 + look.aura[0] * aura * auraGain + look.core[0] * core * coreGain + 255 * (sheen * 0.08 + hot) * coreGain;
      let g = 6 + look.aura[1] * aura * auraGain + look.core[1] * core * coreGain + 244 * (sheen * 0.08 + hot) * coreGain;
      let b = 12 + look.aura[2] * aura * auraGain + look.core[2] * core * coreGain + 230 * (sheen * 0.08 + hot) * coreGain;
      r += 255 * ring;
      g += 196 * ring;
      b += 140 * ring;
      const o = i * 4;
      data[o] = r > 255 ? 255 : r;
      data[o + 1] = g > 255 ? 255 : g;
      data[o + 2] = b > 255 ? 255 : b;
      data[o + 3] = 255;
    }
    return data;
  }
}
