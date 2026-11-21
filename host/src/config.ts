import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in host/.env (see host/.env.example).`);
  return value;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

/** Thread env passed through to the agent: provider choices only, never keys. */
function threadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['VOICE_STT_PROVIDER', 'VOICE_TTS_PROVIDER', 'OPENAI_TTS_VOICE']) {
    if (process.env[name]) env[name] = process.env[name]!;
  }
  return env;
}

export function loadConfig() {
  return {
    standardAgents: {
      baseUrl: process.env.SA_BASE_URL ?? 'http://127.0.0.1:5173',
      agentId: process.env.SA_AGENT ?? 'voice_concierge',
      threadEnv: threadEnv(),
    },
    livekit: {
      url: required('LIVEKIT_URL'),
      apiKey: required('LIVEKIT_API_KEY'),
      apiSecret: required('LIVEKIT_API_SECRET'),
      room: process.env.LIVEKIT_ROOM ?? `sa-voice-${Math.random().toString(36).slice(2, 8)}`,
    },
    vad: {
      marginDb: number('VAD_MARGIN_DB', 12),
      minSpeechDb: number('VAD_MIN_SPEECH_DB', -48),
    },
    turn: {
      minSpeechMs: number('TURN_MIN_SPEECH_MS', 160),
      prerollMs: number('TURN_PREROLL_MS', 300),
    },
    bargeIn: {
      bargeInEnabled: process.env.BARGE_IN !== 'off',
      bargeInMs: number('BARGE_IN_MS', 240),
    },
  };
}

export type HostConfig = ReturnType<typeof loadConfig>;
