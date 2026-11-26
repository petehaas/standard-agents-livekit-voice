import { defineTool } from '@standardagents/spec';
import { z } from 'zod';
import { callerSupplied, describeLookup, lookupOrder } from '../../src/orders.ts';
import { showCard } from '../../src/voice/streams.ts';

export default defineTool({
  description:
    'Look up a Harbor Goods order once the caller has given a name or an order number in their latest message, and show that order on their screen when exactly one order matches. Pass only words from that message. Never pass a name from an earlier turn or from an example.',
  args: z.object({
    customerName: z
      .string()
      .optional()
      .describe('The name the caller gave, in their words'),
    orderNumber: z
      .string()
      .optional()
      .describe('The order number the caller gave. Use digits when they said digits.'),
  }),
  execute: async (state, args) => {
    const { messages } = await state.getMessages({ limit: 8, order: 'desc' });
    const latest = messages.find((message) => message.role === 'user' && message.content);
    const gate = callerSupplied(latest?.content ?? '', args);
    if (gate === 'not_yet') {
      return {
        status: 'success' as const,
        result:
          'The caller has not given a name or an order number yet. Ask for the name on the order. Do not guess a customer, and do not call lookup_order again until they answer.',
      };
    }
    if (gate === 'not_said') {
      return {
        status: 'success' as const,
        result:
          'That name or number is not in the caller\'s latest message. Call lookup_order again with only the words they just said. Do not reuse a previous customer.',
      };
    }
    const found = lookupOrder(args);
    let shown = false;
    if (found.outcome === 'found' && state.runtimeStreams) {
      const pushed = await showCard(state.runtimeStreams, { ...found.card });
      shown = pushed.ok;
    }
    let result = describeLookup(found, shown);
    // Speech-to-text often clips a name ("Amir" for "Samir"). The lookup already
    // matched the closest customer; without this line the model saw the names
    // differ and told the caller nothing was found while the card was on screen.
    const said = args.customerName?.trim();
    if (found.outcome === 'found' && said && said.toLowerCase() !== found.customerName.toLowerCase()) {
      result += `\nmatch: the transcript said "${said}", which is how speech recognition heard ${found.customerName}. This IS their order. Give the status using the name ${found.customerName}. Do not say it was not found.`;
    }
    return { status: 'success' as const, result };
  },
});
