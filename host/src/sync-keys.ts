/**
 * `npm run sync-keys`: copy the speech provider keys from agent/.dev.vars into
 * the local runtime's instance variables, where the voice handler's
 * `state.env()` can read them. Run it once after starting the dev server.
 *
 * Only the names below are copied, and only to the local dev server you point
 * SA_BASE_URL at. Nothing is printed except the names.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { log, resolveToken } from '@petehaas/standard-agents-livekit-host';

const NAMES = ['OPENAI_API_KEY', 'DEEPGRAM_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'];
const TEXT_NAMES = new Set(['ELEVENLABS_VOICE_ID']);

function readDevVars(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

async function main() {
  const baseUrl = process.env.SA_BASE_URL ?? 'http://127.0.0.1:5173';
  const devVarsPath = fileURLToPath(new URL('../../agent/.dev.vars', import.meta.url));
  const devVars = readDevVars(devVarsPath);

  const envPatch: Record<string, string> = {};
  const envTypePatch: Record<string, 'text' | 'secret'> = {};
  for (const name of NAMES) {
    if (!devVars[name]) continue;
    envPatch[name] = devVars[name];
    envTypePatch[name] = TEXT_NAMES.has(name) ? 'text' : 'secret';
  }
  if (Object.keys(envPatch).length === 0) {
    throw new Error(`agent/.dev.vars has none of ${NAMES.join(', ')}.`);
  }

  const token = await resolveToken(baseUrl);
  const response = await fetch(new URL('/api/envs/instance', baseUrl), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ env_patch: envPatch, env_type_patch: envTypePatch }),
  });
  if (!response.ok) throw new Error(`PATCH /api/envs/instance returned ${response.status}: ${await response.text()}`);
  log.info('keys', `set instance variables: ${Object.keys(envPatch).join(', ')}`);
}

// Exit explicitly: the host package loads LiveKit's native module, which keeps the event loop alive.
main().then(() => process.exit(0), (error) => {
  log.error('keys', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
