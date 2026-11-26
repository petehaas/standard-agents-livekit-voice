/**
 * Silero VAD: a speech-vs-noise model, so a bark or a door slam does not
 * open a turn or interrupt the agent. The model is Silero VAD v5 (MIT).
 * Loudness detection stays available when the model cannot be loaded.
 */
import { fileURLToPath } from 'node:url';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import { frameDb, type SpeechClassifier, type SpeechDecision } from './vad.js';

const SAMPLE_RATE = 16_000;
const WINDOW = 512;
const CONTEXT = 64;
/** Keep the speech flag up across a short gap inside a word, then let the turn end. */
const HANGOVER_SAMPLES = Math.round(SAMPLE_RATE * 0.08);

export class SileroVad implements SpeechClassifier {
  readonly sequential = true;
  private readonly input = new Float32Array(CONTEXT + WINDOW);
  private readonly context = new Float32Array(CONTEXT);
  private readonly state = new Float32Array(2 * 1 * 128);
  private readonly sampleRate = BigInt64Array.from([BigInt(SAMPLE_RATE)]);
  private pending = new Float32Array(0);
  private probability = 0;
  private voiced = false;
  private hangover = 0;
  private noiseFloorDb = -60;

  private constructor(
    private readonly session: InferenceSession,
    private readonly threshold: number,
  ) {}

  static async load(threshold = 0.5): Promise<SileroVad> {
    const model = fileURLToPath(new URL('../models/silero_vad.onnx', import.meta.url));
    const session = await InferenceSession.create(model, {
      interOpNumThreads: 1,
      intraOpNumThreads: 1,
      executionMode: 'sequential',
      executionProviders: [{ name: 'cpu' }],
    });
    return new SileroVad(session, threshold);
  }

  get floorDb() {
    return this.noiseFloorDb;
  }

  async process(samples: Int16Array): Promise<SpeechDecision> {
    const db = frameDb(samples);
    const floats = new Float32Array(this.pending.length + samples.length);
    floats.set(this.pending, 0);
    for (let i = 0; i < samples.length; i++) floats[this.pending.length + i] = samples[i] / 32768;
    let offset = 0;
    while (floats.length - offset >= WINDOW) {
      const window = floats.subarray(offset, offset + WINDOW);
      offset += WINDOW;
      this.probability += 0.35 * ((await this.score(window)) - this.probability);
      this.voiced = this.probability >= this.threshold;
      if (this.voiced) this.hangover = HANGOVER_SAMPLES;
    }
    this.pending = floats.slice(offset);

    let speech = this.voiced;
    if (!speech && this.hangover > 0) {
      speech = true;
      this.hangover -= samples.length;
    }
    if (!speech) {
      const rate = db < this.noiseFloorDb ? 0.2 : 0.02;
      this.noiseFloorDb += (db - this.noiseFloorDb) * rate;
    }
    return { speech, db };
  }

  private async score(window: Float32Array): Promise<number> {
    this.input.set(this.context, 0);
    this.input.set(window, CONTEXT);
    const result = await this.session.run({
      input: new Tensor('float32', this.input, [1, CONTEXT + WINDOW]),
      state: new Tensor('float32', this.state, [2, 1, 128]),
      sr: new Tensor('int64', this.sampleRate),
    });
    const next = result.stateN.data;
    if (!(next instanceof Float32Array)) throw new Error('Silero returned an unexpected state.');
    this.state.set(next);
    this.context.set(this.input.subarray(WINDOW));
    const output = result.output.data;
    if (!(output instanceof Float32Array) || output.length === 0) throw new Error('Silero returned no probability.');
    return output[0];
  }
}
