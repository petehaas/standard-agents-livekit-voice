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
  title: 'Harbor Goods orders',
  description: 'Looks up a Harbor Goods order by its three-digit number and shows it on the caller\'s screen.',
  // maxSteps counts every model call in the session, not per turn. At 6, the
  // call went silent on the caller's fourth question. Keep it well above
  // maxSessionTurns (each turn is one or two steps: an optional lookup, then the reply).
  sideA: { label: 'Order support', prompt: 'voice_concierge', maxSteps: 200, stopOnResponse: true },
  sideB: { label: 'Caller (voice)', handler: 'voice_caller' },
  maxSessionTurns: 80,
  // Non-secret defaults. A thread env value overrides each one.
  env: {
    VOICE_STT_PROVIDER: 'openai',
    VOICE_TTS_PROVIDER: 'openai',
    // Short clips get transcribed as Chinese when the language is left open.
    VOICE_STT_LANGUAGE: 'en',
    // Words speech-to-text should expect.
    VOICE_STT_KEYTERMS: 'Harbor Goods, order number',
  },
});
