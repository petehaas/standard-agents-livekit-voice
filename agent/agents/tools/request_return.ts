import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { allChanges, currentOrder, NO_ORDER, setPending, show } from '../../src/call-state.ts';
import { confirmCard, planReturn } from '../../src/fulfillment.ts';

export default defineTool({
  description:
    'Propose a return for the delivered order on screen. This does not start it yet. It shows the return on screen; read it back and ask the caller to say yes, then call confirm_change.',
  args: z.object({
    reason: z.string().describe('Why they are returning it, in a few words, like "wrong size". Use "not given" if they did not say.'),
  }),
  execute: async (state, args) => {
    const order = await currentOrder(state);
    if (!order) return { status: 'success' as const, result: NO_ORDER };
    const plan = planReturn(order, args.reason, (await allChanges(state))[order.orderNumber]);
    if (!plan.ok) return { status: 'success' as const, result: `not possible: ${plan.reason}` };
    await setPending(state, plan.pending);
    await show(state, confirmCard(order, plan.pending, new Date()));
    return {
      status: 'success' as const,
      result: `pending, not started yet: ${plan.pending.summary}.\nsay: read this back in one sentence and ask them to say yes to confirm. Call confirm_change only after they say yes.`,
    };
  },
});
