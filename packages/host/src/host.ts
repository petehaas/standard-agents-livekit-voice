/**
 * startVoiceHost: run one voice call for a Standard Agent in a LiveKit room.
 *
 * 1. Create a thread for the agent.
 * 2. Attach to the thread's bridge as its execution owner and serve the
 *    livekit.speak, livekit.listen, livekit.show, livekit.caption, and
 *    livekit.hangup runtime streams.
 * 3. Join the LiveKit room and publish the agent's voice.
 * 4. When a caller joins, tell the agent the caller connected. From then on
 *    the agent drives the call; the host only moves audio.
 */
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { CALL_CONNECTED, CAPABILITY } from '@petehaas/standard-agents-livekit-voice/protocol';
import { ExecutionHostBridge } from './bridge.js';
import { serveCaption } from './capabilities/caption.js';
import { serveHangup } from './capabilities/hangup.js';
import { serveListen, type ListenOptions } from './capabilities/listen.js';
import { serveShow } from './capabilities/show.js';
import { serveSpeak, type SpeakOptions } from './capabilities/speak.js';
import { TurnClock } from './events.js';
import { log } from './log.js';
import { MicTap } from './mic.js';
import { CallRoom } from './room.js';
import { SileroVad } from './silero.js';
import { ThreadsApi } from './threads.js';
import type { VadOptions } from './vad.js';

export interface LiveKitOptions {
  url: string;
  apiKey: string;
  apiSecret: string;
  room: string;
}

export interface VoiceHostOptions {
  /** The runtime's base URL and a bearer token for its Thread API. */
  runtime: { baseUrl: string; apiKey: string };
  /** The agent to start a thread for. */
  agentId: string;
  /** Thread env, such as provider choices. Never put keys here. */
  threadEnv?: Record<string, string>;
  threadTags?: string[];
  livekit: LiveKitOptions;
  /** Display name of the agent participant. */
  agentName?: string;
  vad?: Partial<VadOptions> & { threshold?: number };
  turn?: Partial<ListenOptions>;
  bargeIn?: Partial<SpeakOptions>;
  /** Called once the call is over: the caller left, the agent hung up, or close() ran. */
  onEnd?: (reason: string) => void;
}

export interface VoiceHost {
  threadId: string;
  room: CallRoom;
  /** Mint a microphone-only token for a caller to join the room. */
  callerToken(identity?: string, name?: string): Promise<string>;
  /** Resolves with the caller's identity once one joins and the agent has been told. */
  callerConnected: Promise<string>;
  close(reason?: string): Promise<void>;
}

/** Mint a LiveKit token. Callers may publish their microphone only. */
export async function liveKitToken(
  livekit: LiveKitOptions,
  identity: string,
  name: string,
  role: 'agent' | 'caller',
): Promise<string> {
  const at = new AccessToken(livekit.apiKey, livekit.apiSecret, { identity, name, ttl: '2h' });
  at.addGrant({
    room: livekit.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    ...(role === 'caller' ? { canPublishSources: [TrackSource.MICROPHONE] } : {}),
  });
  return at.toJwt();
}

export async function startVoiceHost(options: VoiceHostOptions): Promise<VoiceHost> {
  const { runtime, livekit } = options;
  const api = new ThreadsApi(runtime.baseUrl, runtime.apiKey);
  const turn: ListenOptions = { minSpeechMs: 240, prerollMs: 300, ...options.turn };
  const bargeIn: SpeakOptions = { bargeInEnabled: true, bargeInMs: 480, ...options.bargeIn };
  const vad: VadOptions = { marginDb: options.vad?.marginDb ?? 12, minSpeechDb: options.vad?.minSpeechDb ?? -48 };

  const threadId = await api.createThread(options.agentId, {
    tags: options.threadTags ?? ['voice', `room:${livekit.room}`],
    env: options.threadEnv,
  });
  log.info('thread', `created ${threadId} for ${options.agentId}`);

  let mic: MicTap;
  try {
    mic = new MicTap(await SileroVad.load(options.vad?.threshold ?? 0.5));
    log.info('vad', 'speech detection is Silero; loud noise alone will not start a turn');
  } catch (error) {
    log.warn('vad', `Silero unavailable (${error instanceof Error ? error.message : String(error)}); using loudness`);
    mic = new MicTap(vad);
  }
  const room = new CallRoom(mic);
  const clock = new TurnClock();

  const bridge = new ExecutionHostBridge({
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
    threadId,
    clientId: `livekit-host-${livekit.room}`,
    clientName: 'LiveKit voice host',
    clientKind: 'media_host',
  });

  let closed = false;
  const close = async (reason = 'closed', stopThread = true) => {
    if (closed) return;
    closed = true;
    log.info('host', `shutting down: ${reason}`);
    if (stopThread) await api.stopThread(threadId).catch(() => {});
    await bridge.close();
    await room.disconnect().catch(() => {});
    options.onEnd?.(reason);
  };

  bridge
    .serve(CAPABILITY.speak, (stream) => serveSpeak(stream, room.speaker, mic, bargeIn, room.presence, room, clock))
    .serve(CAPABILITY.listen, (stream) => serveListen(stream, mic, turn, room.presence, clock))
    .serve(CAPABILITY.show, (stream) => serveShow(stream, room))
    .serve(CAPABILITY.caption, (stream) => serveCaption(stream, room, clock))
    .serve(CAPABILITY.hangup, (stream) => serveHangup(stream, (reason) => void close(reason, false)));
  await bridge.connect();

  await room.connect(livekit.url, await liveKitToken(livekit, 'standard-agent', options.agentName ?? 'Agent', 'agent'));
  room.onLeave(() => void close('the caller left'));

  const callerConnected = room.waitForCaller().then(async (caller) => {
    log.info('host', `${caller} connected; handing the call to the agent`);
    await api.sendMessage(threadId, CALL_CONNECTED);
    return caller;
  });

  return {
    threadId,
    room,
    callerToken: (identity = `caller-${Date.now().toString(36)}`, name = 'Caller') =>
      liveKitToken(livekit, identity, name, 'caller'),
    callerConnected,
    close: (reason) => close(reason),
  };
}
