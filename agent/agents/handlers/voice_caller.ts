import { defineHandler } from '@standardagents/spec';
import { voiceCallerHandler } from '@petehaas/standard-agents-livekit-voice';

/**
 * The caller's side of a voice call, from @petehaas/standard-agents-livekit-voice.
 *
 * Side A (a prompt) writes text replies. This handler turns each reply into
 * audio in the LiveKit room, then waits for the caller's next utterance and
 * injects its transcript as side B's message. All audio moves over runtime
 * streams; the handler never touches LiveKit directly.
 */
export default defineHandler(voiceCallerHandler());
