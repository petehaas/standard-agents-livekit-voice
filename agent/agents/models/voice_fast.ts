import { defineModel } from '@standardagents/spec';
import { openai } from '@standardagents/openai';

// Voice turns are latency-bound, so the reply model should be small and fast.
// Swap in any provider package; the voice side does not depend on this choice.
export default defineModel({
  name: 'voice_fast',
  provider: openai,
  model: 'gpt-6-luna',
});
