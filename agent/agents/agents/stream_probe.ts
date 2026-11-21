import { defineAgent } from '@standardagents/spec';

/**
 * A self-test for the runtime stream plumbing. No model, no speech provider,
 * no keys: send it any message while an execution host is attached, and it
 * replies with what happened on each capability. Run it with `npm run probe`
 * in host/.
 */
export default defineAgent({
  name: 'stream_probe',
  title: 'Runtime Stream Probe',
  description: 'Exercises livekit.speak and livekit.listen without a model or speech provider.',
  sideA: { label: 'Probe', handler: 'stream_probe' },
  sideB: { label: 'Tester', human: true },
  maxSessionTurns: 10,
});
