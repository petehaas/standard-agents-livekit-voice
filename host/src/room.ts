/**
 * The LiveKit side of the host: one room, one published agent voice track,
 * and the caller's microphone feeding the MicTap.
 */
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { SPEAK_SAMPLE_RATE } from '../../agent/src/voice/protocol.ts';
import type { Speaker } from './capabilities/speak.js';
import { log } from './log.js';
import { FRAME_MS, MIC_SAMPLE_RATE, type MicTap } from './mic.js';

export class CallRoom {
  readonly room = new Room();
  private readonly source = new AudioSource(SPEAK_SAMPLE_RATE, 1);
  private callerIdentity: string | null = null;
  private onCaller: ((identity: string) => void) | null = null;
  private onCallerLeft: (() => void) | null = null;

  constructor(private readonly mic: MicTap) {}

  async connect(url: string, token: string) {
    await this.room.connect(url, token, { autoSubscribe: true, dynacast: false });
    const track = LocalAudioTrack.createAudioTrack('agent-voice', this.source);
    await this.room.localParticipant!.publishTrack(
      track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    );
    log.info('livekit', `joined room "${this.room.name}" and published the agent voice`);

    this.room.on(RoomEvent.TrackSubscribed, (remote: RemoteTrack, _publication, participant: RemoteParticipant) => {
      if (remote.kind !== TrackKind.KIND_AUDIO) return;
      if (this.callerIdentity && this.callerIdentity !== participant.identity) {
        log.warn('livekit', `ignoring audio from ${participant.identity}; this demo serves one caller`);
        return;
      }
      this.callerIdentity = participant.identity;
      log.info('livekit', `listening to ${participant.identity}`);
      void this.readMic(remote);
      this.onCaller?.(participant.identity);
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      if (participant.identity !== this.callerIdentity) return;
      log.info('livekit', `${participant.identity} left the room`);
      this.onCallerLeft?.();
    });
  }

  /** Resolve once a caller's microphone is subscribed. */
  waitForCaller(): Promise<string> {
    if (this.callerIdentity) return Promise.resolve(this.callerIdentity);
    return new Promise((resolve) => (this.onCaller = resolve));
  }

  onLeave(callback: () => void) {
    this.onCallerLeft = callback;
  }

  private async readMic(track: RemoteTrack) {
    // LiveKit resamples to 16 kHz mono and hands us 20 ms frames.
    const stream = new AudioStream(track, { sampleRate: MIC_SAMPLE_RATE, numChannels: 1, frameSizeMs: FRAME_MS });
    try {
      for await (const frame of stream) this.mic.push(frame.data);
    } catch (error) {
      log.warn('livekit', `microphone stream ended: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The agent's voice, as the speak capability sees it. */
  readonly speaker: Speaker = {
    play: (samples, sampleRate) => this.source.captureFrame(new AudioFrame(samples, sampleRate, 1, samples.length)),
    clear: () => this.source.clearQueue(),
    queuedMs: () => this.source.queuedDuration,
    waitForPlayout: () => this.source.waitForPlayout(),
  };

  async disconnect() {
    await this.source.waitForPlayout().catch(() => {});
    await this.room.disconnect();
    await this.source.close();
  }
}
