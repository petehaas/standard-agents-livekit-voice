import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { allChanges, callerWords, pendingChange, saveChanges, setPending, show } from '../../src/call-state.ts';
import { applyChange, findOrder, isAffirmative } from '../../src/fulfillment.ts';
import { present } from '../../src/orders.ts';

export default defineTool({
  description:
    'Apply the change the caller just agreed to (a delivery change or a return). Call it only right after the caller says yes to the change you read back.',
  args: z.object({}),
  execute: async (state) => {
    const pending = await pendingChange(state);
    const order = findOrder(pending?.orderNumber);
    if (!pending || !order) return { status: 'success' as const, result: 'There is no change waiting. Ask what they would like to change.' };

    // The caller's own words approve the change, not the model's reading of them.
    const [latest = ''] = await callerWords(state, 6);
    if (!isAffirmative(latest)) {
      return {
        status: 'success' as const,
        result: `not applied: the caller's last words ("${latest}") are not a clear yes. If they said no, call cancel_change. Otherwise ask once more whether to ${pending.summary}.`,
      };
    }

    const changes = applyChange(pending, (await allChanges(state))[order.orderNumber]);
    await saveChanges(state, order.orderNumber, changes);
    await setPending(state, null);

    const today = new Date();
    const found = present(order, today, changes);
    const updated =
      pending.type === 'return'
        ? `Return started · code ${changes.returnCode}`
        : pending.deliveryInDays !== undefined
          ? `Delivery moved to ${found.deliveryDate}`
          : 'Delivery instructions saved';
    await show(state, { ...found.card, updated });

    const result =
      pending.type === 'return'
        ? `done: return started. Return code ${changes.returnCode!.split('').join(' ')}, on their screen. They drop it off at any Parcelway location within 30 days; the refund follows within 5 business days of drop-off.\nsay: confirm in one or two sentences, then ask if there is anything else.`
        : `done: ${pending.summary}. ${found.say}\nsay: confirm in one sentence, then ask if there is anything else.`;
    return { status: 'success' as const, result };
  },
});
