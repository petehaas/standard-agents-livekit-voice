import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeLookup, lookupOrder, ORDERS, spokenDigits } from '../../agent/src/orders.ts';
import { serveShow, type HostStream } from 'standardagent-livekit-host';

const today = new Date(2026, 10, 25); // Wednesday, November 25, 2026

test('every order has a unique three-digit number', () => {
  const numbers = ORDERS.map((order) => order.orderNumber);
  assert.deepEqual(numbers, ['111', '222', '333', '444', '555']);
  assert.equal(new Set(numbers).size, numbers.length);
});

test('order 111 is in process and due two days from today', () => {
  const found = lookupOrder({ spoken: 'My order number is 111.' }, today);
  assert.equal(found.outcome, 'found');
  if (found.outcome !== 'found') return;
  assert.equal(found.customerName, 'Maya Chen');
  assert.equal(found.status, 'in_process');
  assert.equal(found.deliveryRelative, 'in 2 days');
  assert.equal(found.deliveryDate, 'Friday, November 27');
  assert.equal(found.card.steps.map((step) => step.state).join(','), 'done,current,upcoming,upcoming');
  assert.equal(found.card.total, '$148');
  assert.equal(found.card.shipsTo, 'Brooklyn');
  assert.equal(found.card.image, '/products/linen-throw.jpg');
  assert.ok(JSON.stringify(found.card).length < 15_000, 'the card must fit in one LiveKit RPC');
  assert.match(found.say, /order 1 1 1/);
  assert.doesNotMatch(found.say, /\$148/);
});

test('spoken forms of an order number become digits', () => {
  const cases: [string, string][] = [
    ['111', '111'],
    ['It is 4 4 4.', '444'],
    ['one one one', '111'],
    ['Triple two.', '222'],
    ['double five five', '555'],
    ['one eleven', '111'],
    ['two twenty two', '222'],
    ['three hundred thirty three', '333'],
    ['six hundred and sixty six', '666'],
    ['one to one', '121'],
    ['Order number for five five five', '555'],
    ['I want to check my order', ''],
  ];
  for (const [said, digits] of cases) assert.equal(spokenDigits(said), digits, said);
});

test('the words the caller said win over the model argument', () => {
  const found = lookupOrder({ spoken: 'two two two', orderNumber: '111' }, today);
  assert.equal(found.outcome === 'found' && found.orderNumber, '222');
  const referBack = lookupOrder({ spoken: 'yes that one', earlier: ['it is 333'], orderNumber: '333' }, today);
  assert.equal(referBack.outcome === 'found' && referBack.orderNumber, '333');
  const invented = lookupOrder({ spoken: 'yes that one', earlier: ['hello'], orderNumber: '333' }, today);
  assert.notEqual(invented.outcome, 'found');
});

test('missing, short, unknown, and noisy numbers stay off the screen', () => {
  assert.equal(lookupOrder({ spoken: '[caller connected]' }, today).outcome, 'need_number');
  assert.equal(lookupOrder({ spoken: 'one one' }, today).outcome, 'incomplete');
  assert.equal(lookupOrder({ spoken: '789' }, today).outcome, 'none');
  assert.equal(lookupOrder({ spoken: '666' }, today).outcome, 'none');
  assert.equal(lookupOrder({ spoken: '123456' }, today).outcome, 'incomplete');
  const extra = lookupOrder({ spoken: 'I bought 2 things, order 444' }, today);
  assert.equal(extra.outcome === 'found' && extra.orderNumber, '444');
  assert.match(describeLookup({ outcome: 'none', orderNumber: '789' }, false), /no order 7 8 9/);
});

test('show forwards the card payload to the caller', async () => {
  let payload = '';
  const stream = {
    metadata: { protocol: 'sa-voice/0', card: { orderNumber: '111', item: 'linen throw blanket' } },
  } as unknown as HostStream;
  await serveShow(stream, {
    showCard: async (body) => {
      payload = body;
      return 'shown';
    },
  });
  assert.equal(JSON.parse(payload).orderNumber, '111');
});
