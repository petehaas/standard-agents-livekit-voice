import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { allChanges, pendingChange, setPending, show } from '../../src/call-state.ts';
import { findOrder } from '../../src/fulfillment.ts';
import { present } from '../../src/orders.ts';

export default defineTool({
  description:
    'Drop the change waiting for approval and take it off the screen. Call it when the caller says no to the change you read back, or changes their mind.',
  args: z.object({}),
  execute: async (state) => {
    const pending = await pendingChange(state);
    const order = findOrder(pending?.orderNumber);
    if (!pending || !order) return { status: 'success' as const, result: 'There is no change waiting. Nothing to cancel.' };

    await setPending(state, null);
    // Put the order back on screen as it is, without the confirmation box.
    const found = present(order, new Date(), (await allChanges(state))[order.orderNumber]);
    await show(state, found.card);
    return {
      status: 'success' as const,
      result: `cancelled: nothing changed (${pending.summary}). The order card is back on screen.\nsay: one short sentence that nothing changed, then ask what they would like instead.`,
    };
  },
});
