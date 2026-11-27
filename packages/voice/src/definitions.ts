/**
 * Ready-made options for an agent package's handler and tool. Wrap them in
 * your own `agents/handlers/` and `agents/tools/` files, so runtimes that
 * read those files statically still see `defineHandler` and `defineTool`:
 *
 *   // agents/handlers/voice_caller.ts
 *   import { defineHandler } from '@standardagents/spec';
 *   import { voiceCallerHandler } from '@petehaas/standard-agents-livekit-voice';
 *   export default defineHandler(voiceCallerHandler());
 *
 *   // agents/tools/end_call.ts
 *   import { defineTool } from '@standardagents/spec';
 *   import { endCallTool } from '@petehaas/standard-agents-livekit-voice';
 *   export default defineTool(endCallTool);
 */
import type { DefineHandlerOptions, DefineToolOptions, ThreadState } from '@standardagents/spec';
import { z } from 'zod';
import { CALL_ENDED_KEY } from './call.js';
import { CALL_CONNECTED } from './protocol.js';
import { loadVoiceConfig, type VoiceConfig } from './config.js';
import { runVoiceTurn } from './turn.js';

export interface VoiceCallerOptions {
  /** Build STT and TTS clients. Defaults to reading VOICE_* and provider keys from thread env. */
  loadVoice?: (state: ThreadState) => Promise<VoiceConfig>;
}

/**
 * A side B handler for a voice call. It speaks each side A reply into the
 * LiveKit room and turns the caller's next utterance into side B's message,
 * all over runtime streams.
 */
export function voiceCallerHandler(options: VoiceCallerOptions = {}): DefineHandlerOptions {
  const loadVoice = options.loadVoice ?? loadVoiceConfig;
  return {
    description:
      "Speaks each reply into the LiveKit room and turns the caller's next utterance into a user message, over runtime streams.",
    execute: (state, message) => runVoiceTurn(state, message, loadVoice),
  };
}

/** A tool side A calls to hang up once its goodbye has played. */
const endCallArgs = z.object({
  reason: z.string().describe('Why the call is ending, in a few words'),
});

export const endCallTool: DefineToolOptions<ThreadState, typeof endCallArgs> = {
  description:
    'End the call. Call this when the caller says goodbye or asks to hang up, then reply with one short goodbye sentence. The call ends after the goodbye plays.',
  args: endCallArgs,
  execute: async (state, { reason }) => {
    // Models sometimes call this on the greeting turn. A call cannot end
    // before the caller has said anything, so code refuses it.
    const { messages } = await state.getMessages({ limit: 10, order: 'desc' });
    const latest = messages.find((message) => message.role === 'user')?.content?.trim();
    if (!latest || latest === CALL_CONNECTED) {
      return {
        status: 'success',
        result: 'Not ended: the caller just connected and has not said anything yet. Do not say goodbye. Greet them and ask how you can help.',
      };
    }
    await state.setValue(CALL_ENDED_KEY, true);
    return { status: 'success', result: `The call will end after your goodbye (${reason}). Reply with one short goodbye sentence.` };
  },
};
