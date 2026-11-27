import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { allChanges, currentOrder, NO_ORDER, show } from '../../src/call-state.ts';
import { trackPackage } from '../../src/fulfillment.ts';

export default defineTool({
  description:
    "Show live tracking for the order on screen: a map of its route, where it is now, and the carrier's scan history. Call it when the caller asks where the package is, for tracking, or for the tracking number.",
  args: z.object({}),
  execute: async (state) => {
    const order = await currentOrder(state);
    if (!order) return { status: 'success' as const, result: NO_ORDER };
    const { card, result } = trackPackage(order, new Date(), (await allChanges(state))[order.orderNumber]);
    const shown = await show(state, card);
    return { status: 'success' as const, result: shown ? result : `${result}\nscreen: the map could not be shown. Describe it briefly.` };
  },
});
