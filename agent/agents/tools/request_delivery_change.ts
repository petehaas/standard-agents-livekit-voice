import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { allChanges, currentOrder, NO_ORDER, setPending, show } from '../../src/call-state.ts';
import { confirmCard, planDeliveryChange } from '../../src/fulfillment.ts';

export default defineTool({
  description:
    'Propose a delivery change for the order on screen: a different delivery day, or where to leave the package. This does not change anything yet. It shows the change on screen; read it back and ask the caller to say yes, then call confirm_change.',
  args: z.object({
    day: z.string().optional().describe('The new delivery day in the caller\'s words, like "Monday" or "December 2nd". Omit if they did not ask to change the day.'),
    instructions: z.string().optional().describe('Where to leave it, in a few words, like "at the side door". Omit if they did not give any.'),
  }),
  execute: async (state, args) => {
    const order = await currentOrder(state);
    if (!order) return { status: 'success' as const, result: NO_ORDER };
    const today = new Date();
    const plan = planDeliveryChange(order, args, today, (await allChanges(state))[order.orderNumber]);
    if (!plan.ok) return { status: 'success' as const, result: `not possible: ${plan.reason}` };
    await setPending(state, plan.pending);
    await show(state, confirmCard(order, plan.pending, today));
    return {
      status: 'success' as const,
      result: `pending, not applied yet: ${plan.pending.summary}.\nsay: read this back in one sentence and ask them to say yes to confirm. Call confirm_change only after they say yes.`,
    };
  },
});
