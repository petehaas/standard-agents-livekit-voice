import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { CALL_ENDED_KEY } from '../../src/voice/call.ts';

export default defineTool({
  description:
    'End the call. Call this when the caller says goodbye or asks to hang up, then reply with one short goodbye sentence. The call ends after the goodbye plays.',
  args: z.object({
    reason: z.string().describe('Why the call is ending, in a few words'),
  }),
  execute: async (state, { reason }) => {
    await state.setValue(CALL_ENDED_KEY, true);
    return { status: 'success', result: `The call will end after your goodbye (${reason}). Reply with one short goodbye sentence.` };
  },
});
