import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { describeLookup, lookupOrder } from '../../src/orders.ts';
import { showCard } from 'standardagent-livekit-voice';

export default defineTool({
  description:
    "Look up a Harbor Goods order by its three-digit order number and show it on the caller's screen. Call it as soon as the caller says an order number.",
  args: z.object({
    orderNumber: z
      .string()
      .describe('The order number exactly as the caller said it, for example "111" or "one one one".'),
  }),
  execute: async (state, args) => {
    // The caller's own words are the source of truth for the number. The
    // model's argument counts only if the caller said it earlier in the call.
    const { messages } = await state.getMessages({ limit: 30, order: 'desc' });
    const said = messages.filter((message) => message.role === 'user' && message.content).map((m) => m.content!);
    const found = lookupOrder({ spoken: said[0] ?? '', earlier: said.slice(1), orderNumber: args.orderNumber });

    let shown = false;
    if (found.outcome === 'found' && state.runtimeStreams) {
      const pushed = await showCard(state.runtimeStreams, { ...found.card });
      shown = pushed.ok;
    }
    return { status: 'success' as const, result: describeLookup(found, shown) };
  },
});
