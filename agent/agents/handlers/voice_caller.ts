import { defineHandler } from '@standardagents/spec';
import { loadVoiceConfig } from '../../src/voice/config.ts';
import { runVoiceTurn } from '../../src/voice/turn.ts';

/**
 * The caller's side of a voice call.
 *
 * Side A (a prompt) writes text replies. This handler turns each reply into
 * audio in the LiveKit room, then waits for the caller's next utterance and
 * injects its transcript as side B's message. All audio moves over runtime
 * streams; the handler never touches LiveKit directly. See src/voice/turn.ts.
 */
export default defineHandler({
  description:
    "Speaks each reply into the LiveKit room and turns the caller's next utterance into a user message, over runtime streams.",
  execute: (state, message) => runVoiceTurn(state, message, loadVoiceConfig),
});
