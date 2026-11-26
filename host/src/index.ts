/**
 * LiveKit execution host for the voice_concierge Standard Agent.
 *
 * 1. Create a thread for the agent.
 * 2. Attach to the thread's bridge as its execution owner and serve the
 *    livekit.speak, livekit.listen, livekit.show, livekit.caption, and livekit.hangup runtime streams.
 * 3. Join a LiveKit room, publish the agent's voice, and wait for a caller.
 * 4. Tell the agent the caller connected. From then on the agent drives the
 *    call; this process only moves audio.
 */
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { CALL_CONNECTED } from '../../agent/src/voice/call.ts';
import { CAPABILITY } from '../../agent/src/voice/protocol.ts';
import { resolveToken } from './auth.js';
import { ExecutionHostBridge } from './bridge.js';
import { serveCaption } from './capabilities/caption.js';
import { serveHangup } from './capabilities/hangup.js';
import { serveListen } from './capabilities/listen.js';
import { serveShow } from './capabilities/show.js';
import { serveSpeak } from './capabilities/speak.js';
import { loadConfig } from './config.js';
import { startDesk } from './desk.js';
import { TurnClock } from './events.js';
import { log } from './log.js';
import { MicTap } from './mic.js';
import { CallRoom } from './room.js';
import { SileroVad } from './silero.js';
import { ThreadsApi } from './threads.js';

async function token(
  config: ReturnType<typeof loadConfig>['livekit'],
  identity: string,
  name: string,
  publish: 'agent' | 'caller',
) {
  const at = new AccessToken(config.apiKey, config.apiSecret, { identity, name, ttl: '2h' });
  at.addGrant({
    room: config.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    // The caller is a customer, not a meeting participant. Microphone only.
    ...(publish === 'caller' ? { canPublishSources: [TrackSource.MICROPHONE] } : {}),
  });
  return at.toJwt();
}

async function main() {
  const config = loadConfig();
  const apiKey = await resolveToken(config.standardAgents.baseUrl);
  const api = new ThreadsApi(config.standardAgents.baseUrl, apiKey);

  const threadId = await api.createThread(config.standardAgents.agentId, {
    tags: ['voice', `room:${config.livekit.room}`],
    env: config.standardAgents.threadEnv,
  });
  log.info('thread', `created ${threadId} for ${config.standardAgents.agentId}`);

  let mic: MicTap;
  try {
    mic = new MicTap(await SileroVad.load(config.vad.threshold));
    log.info('vad', 'speech detection is Silero; loud noise alone will not start a turn');
  } catch (error) {
    log.warn('vad', `Silero unavailable (${error instanceof Error ? error.message : String(error)}); using loudness`);
    mic = new MicTap(config.vad);
  }
  const room = new CallRoom(mic);
  const clock = new TurnClock();

  let shuttingDown = false;
  const bridge = new ExecutionHostBridge({
    baseUrl: config.standardAgents.baseUrl,
    apiKey,
    threadId,
    clientId: `livekit-host-${config.livekit.room}`,
    clientName: 'LiveKit voice host',
    clientKind: 'media_host',
  });

  const shutdown = async (reason: string, stopThread: boolean) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('host', `shutting down: ${reason}`);
    if (stopThread) await api.stopThread(threadId).catch(() => {});
    await bridge.close();
    await room.disconnect().catch(() => {});
    process.exit(0);
  };

  bridge
    .serve(CAPABILITY.speak, (stream) => serveSpeak(stream, room.speaker, mic, config.bargeIn, room.presence, room, clock))
    .serve(CAPABILITY.listen, (stream) => serveListen(stream, mic, config.turn, room.presence, clock))
    .serve(CAPABILITY.show, (stream) => serveShow(stream, room))
    .serve(CAPABILITY.caption, (stream) => serveCaption(stream, room, clock))
    .serve(CAPABILITY.hangup, (stream) => serveHangup(stream, (reason) => void shutdown(reason, false)));
  await bridge.connect();

  await room.connect(config.livekit.url, await token(config.livekit, 'standard-agent', 'Harbor Goods', 'agent'));
  room.onLeave(() => void shutdown('the caller left', true));
  process.on('SIGINT', () => void shutdown('interrupted', true));

  const callerToken = await token(config.livekit, `caller-${Date.now().toString(36)}`, 'Caller', 'caller');
  const desk = await startDesk({ liveKitUrl: config.livekit.url, token: callerToken });
  console.log(`\n  Open the support desk:\n  ${desk}\n`);

  const caller = await room.waitForCaller();
  log.info('host', `${caller} connected; handing the call to the agent`);
  await api.sendMessage(threadId, CALL_CONNECTED);
}

main().catch((error) => {
  log.error('host', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
