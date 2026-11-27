import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { allChanges, callerWords, setCurrentOrder, setPending, show } from '../../src/call-state.ts';
import { describeLookup, lookupOrder } from '../../src/orders.ts';

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
    const said = await callerWords(state);
    const found = lookupOrder({ spoken: said[0] ?? '', earlier: said.slice(1), orderNumber: args.orderNumber }, new Date(), await allChanges(state));

    let shown = false;
    if (found.outcome === 'found') {
      await setCurrentOrder(state, found.orderNumber);
      await setPending(state, null);
      shown = await show(state, found.card);
    }
    return { status: 'success' as const, result: describeLookup(found, shown) };
  },
});
