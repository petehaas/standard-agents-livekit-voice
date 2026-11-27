/**
 * The LiveKit side of the host: one room, one published agent voice track,
 * and the caller's microphone feeding the MicTap.
 */
import { NoiseCancellation } from '@livekit/noise-cancellation-node';
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  LocalVideoTrack,
  type RemoteParticipant,
  type RemoteTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  VideoBufferType,
  VideoFrame,
  VideoSource,
} from '@livekit/rtc-node';
import { CALL_EVENTS_TOPIC, SHOW_CARD_RPC, SPEAK_SAMPLE_RATE } from '@petehaas/standard-agents-livekit-voice/protocol';
import type { Speaker } from './capabilities/speak.js';
import { log } from './log.js';
import { FRAME_MS, MIC_SAMPLE_RATE, type MicTap } from './mic.js';
import type { CallEvent, CallEvents } from './events.js';
import { AgentPresence, AURA_SIZE, AuraFrames } from './aura.js';

const AURA_FPS = 10;

export class CallRoom implements CallEvents {
  readonly room = new Room();
  readonly presence = new AgentPresence();
  private readonly source = new AudioSource(SPEAK_SAMPLE_RATE, 1);
  private readonly aura = new AuraFrames();
  private videoSource: VideoSource | null = null;
  private videoTimer: ReturnType<typeof setInterval> | null = null;
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
    await this.publishAura();

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

  /** Send a call event (caption, latency) to the caller's screen. Best effort. */
  emit(event: CallEvent) {
    const participant = this.room.localParticipant;
    if (!participant || !this.callerIdentity) return;
    const payload = new TextEncoder().encode(JSON.stringify(event));
    participant
      .publishData(payload, { reliable: true, topic: CALL_EVENTS_TOPIC, destination_identities: [this.callerIdentity] })
      .catch((error: unknown) => log.warn('livekit', `event not sent: ${error instanceof Error ? error.message : String(error)}`));
  }

  /** Put a card on the caller's screen. The caller's page registers `show_card`. */
  showCard(payload: string): Promise<string> {
    const destinationIdentity = this.callerIdentity;
    const participant = this.room.localParticipant;
    if (!destinationIdentity || !participant) throw new Error('No caller is in the room.');
    return participant.performRpc({
      destinationIdentity,
      method: SHOW_CARD_RPC,
      payload,
      responseTimeout: 5_000,
    });
  }

  private async readMic(track: RemoteTrack) {
    // LiveKit resamples to 16 kHz mono and hands us 20 ms frames.
    // Krisp runs here, on the way in, so the browser keeps its own echo
    // cancellation and does not also run a noise-cancellation model.
    const format = { sampleRate: MIC_SAMPLE_RATE, numChannels: 1, frameSizeMs: FRAME_MS };
    let stream: AudioStream;
    try {
      stream = new AudioStream(track, { ...format, noiseCancellation: NoiseCancellation() });
      log.info('livekit', 'suppressing background noise on the caller microphone');
    } catch (error) {
      log.warn('livekit', `noise cancellation unavailable: ${error instanceof Error ? error.message : String(error)}`);
      stream = new AudioStream(track, format);
    }
    try {
      for await (const frame of stream) await this.mic.push(frame.data);
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

  /** A camera track of the orb, so the meeting view has something that breathes with the call. */
  private async publishAura() {
    let source: VideoSource | null = null;
    try {
      source = new VideoSource(AURA_SIZE, AURA_SIZE);
      const track = LocalVideoTrack.createVideoTrack('concierge', source);
      await this.room.localParticipant!.publishTrack(
        track,
        new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA }),
      );
      const frame = new VideoFrame(this.aura.buffer, AURA_SIZE, AURA_SIZE, VideoBufferType.RGBA);
      let tick = 0;
      let stamp = 0n;
      const step = BigInt(Math.round(1_000_000 / AURA_FPS));
      this.videoSource = source;
      this.aura.render(this.presence.mode, 0);
      source.captureFrame(frame, stamp);
      this.videoTimer = setInterval(() => {
        if (this.videoSource !== source) return;
        try {
          this.aura.render(this.presence.mode, tick++);
          source!.captureFrame(frame, (stamp += step));
        } catch (error) {
          log.warn('livekit', `aura frame failed: ${error instanceof Error ? error.message : String(error)}`);
          this.stopAura();
        }
      }, 1000 / AURA_FPS);
      log.info('livekit', 'published the concierge aura');
    } catch (error) {
      log.warn('livekit', `aura unavailable: ${error instanceof Error ? error.message : String(error)}`);
      if (this.videoSource) this.stopAura();
      else await source?.close().catch(() => {});
    }
  }

  private stopAura() {
    if (this.videoTimer) clearInterval(this.videoTimer);
    this.videoTimer = null;
    const source = this.videoSource;
    this.videoSource = null;
    void source?.close().catch(() => {});
  }

  async disconnect() {
    this.stopAura();
    await this.source.waitForPlayout().catch(() => {});
    await this.room.disconnect();
    await this.source.close();
  }
}
