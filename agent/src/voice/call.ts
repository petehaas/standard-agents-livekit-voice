/** Call-level constants shared by the handler, the tools, and the prompt. */

/** Thread value set by the end_call tool. The handler hangs up after the goodbye plays. */
export const CALL_ENDED_KEY = 'voice_call_ended';

/** What side A receives when the caller stays silent. The prompt knows this token. */
export const NO_RESPONSE = '[no response]';

/** What the host sends as the first message, once the caller is in the room. */
export const CALL_CONNECTED = '[caller connected]';
