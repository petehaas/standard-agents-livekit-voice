import { defineAgent } from '@standardagents/spec';

/**
 * A voice call as a two-sided Standard Agent.
 *
 * Side A is an ordinary prompt: it reads transcripts and writes text.
 * Side B is the voice_caller handler: it speaks side A's text into a LiveKit
 * room and turns the caller's speech back into text, using runtime streams to
 * reach the LiveKit execution host. Neither side knows the other is voice.
 */
export default defineAgent({
  name: 'voice_concierge',
  title: 'Voice Concierge',
  description: 'Talks with a caller in a LiveKit room. Audio moves over runtime streams to a LiveKit execution host.',
  sideA: { label: 'Concierge', prompt: 'voice_concierge', maxSteps: 6, stopOnResponse: true },
  sideB: { label: 'Caller (voice)', handler: 'voice_caller' },
  maxSessionTurns: 80,
  // Non-secret defaults. A thread env value overrides each one.
  env: {
    VOICE_STT_PROVIDER: 'openai',
    VOICE_TTS_PROVIDER: 'openai',
  },
});
