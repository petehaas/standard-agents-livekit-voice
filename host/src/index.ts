/**
 * The support desk demo: runs standardagent-livekit-host for the
 * voice_concierge agent and serves a local page for the caller.
 */
import { log, resolveToken, startVoiceHost } from 'standardagent-livekit-host';
import { loadConfig } from './config.js';
import { startDesk } from './desk.js';

async function main() {
  const config = loadConfig();
  const host = await startVoiceHost({
    runtime: { baseUrl: config.standardAgents.baseUrl, apiKey: await resolveToken(config.standardAgents.baseUrl) },
    agentId: config.standardAgents.agentId,
    threadEnv: config.standardAgents.threadEnv,
    livekit: config.livekit,
    agentName: 'Harbor Goods',
    vad: config.vad,
    turn: config.turn,
    bargeIn: config.bargeIn,
    onEnd: () => process.exit(0),
  });
  process.on('SIGINT', () => void host.close('interrupted'));

  const desk = await startDesk({ liveKitUrl: config.livekit.url, token: await host.callerToken() });
  console.log(`\n  Open the support desk:\n  ${desk}\n`);
  await host.callerConnected;
}

main().catch((error) => {
  log.error('host', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
