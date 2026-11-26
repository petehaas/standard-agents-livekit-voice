import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callerSupplied, lookupOrder } from '../../agent/src/orders.ts';
import { serveShow } from '../src/capabilities/show.ts';
import type { HostStream } from '../src/bridge.ts';

const today = new Date(2026, 10, 25); // Wednesday, November 25, 2026

test('Maya Chen is in process and due two days from today', () => {
  const found = lookupOrder({ customerName: 'my name is Maya' }, today);
  assert.equal(found.outcome, 'found');
  if (found.outcome !== 'found') return;
  assert.equal(found.orderNumber, '1842');
  assert.equal(found.status, 'in_process');
  assert.equal(found.deliveryRelative, 'in 2 days');
  assert.equal(found.deliveryDate, 'Friday, November 27');
  assert.equal(found.card.steps.map((step) => step.state).join(','), 'done,current,upcoming,upcoming');
  assert.equal(found.card.title, 'Linen throw blanket');
  assert.equal(found.card.detail, 'Oatmeal, 50 by 60 inches');
  assert.equal(found.card.total, '$148');
  assert.equal(found.card.shipsTo, 'Brooklyn');
  assert.equal(found.card.placedLabel, 'Tuesday, November 24');
  assert.equal(found.card.image, '/products/linen-throw.jpg');
  assert.ok(JSON.stringify(found.card).length < 15_000, 'the card must fit in one LiveKit RPC');
  assert.match(found.say, /Friday, November 27/);
  assert.doesNotMatch(found.say, /\$148/);
});

test('the book has more than the original three orders', () => {
  const found = lookupOrder({ customerName: 'Jonah Ellis' }, today);
  assert.equal(found.outcome, 'found');
  if (found.outcome !== 'found') return;
  assert.equal(found.orderNumber, '2018');
  assert.equal(found.item, 'stoneware dinner plates');
  assert.equal(found.deliveryRelative, 'in 3 days');
  assert.equal(found.card.image, '/products/dinner-plates.jpg');
  assert.equal(lookupOrder({ orderNumber: '1695' }, today).outcome, 'found');
});

test('an order number finds the same customer, and a conflicting name does not', () => {
  const byNumber = lookupOrder({ orderNumber: '1904' }, today);
  assert.equal(byNumber.outcome, 'found');
  if (byNumber.outcome === 'found') assert.equal(byNumber.customerName, 'Andre Walsh');

  const clash = lookupOrder({ customerName: 'Andre Walsh', orderNumber: '1842' }, today);
  assert.equal(clash.outcome, 'mismatch');
});

test('unknown names, empty input, and two names stay off the screen', () => {
  assert.equal(lookupOrder({ customerName: 'Sam Rivera' }, today).outcome, 'none');
  assert.equal(lookupOrder({}, today).outcome, 'need_name');
  const many = lookupOrder({ customerName: 'Maya and Andre' }, today);
  assert.equal(many.outcome, 'many');
  if (many.outcome === 'many') assert.deepEqual(many.names.sort(), ['Andre Walsh', 'Maya Chen']);
});

test('a lookup has to use the name the caller just said', () => {
  assert.equal(callerSupplied('[caller connected]', { customerName: 'Maya Chen' }), 'not_yet');
  assert.equal(callerSupplied('Jonah Ellis?', { customerName: 'Jonah Ellis' }), 'ok');
  assert.equal(callerSupplied('Jonah Ellis?', { customerName: 'Maya Chen' }), 'not_said');
  assert.equal(callerSupplied('order 1904', { orderNumber: '1904' }), 'ok');
  assert.equal(callerSupplied('Andre Walsh', { customerName: 'Andre', orderNumber: '1842' }), 'not_said');
});

test('show forwards the card payload to the caller', async () => {
  let payload = '';
  const stream = {
    metadata: { protocol: 'sa-voice/0', card: { orderNumber: '1842', item: 'linen throw blanket' } },
  } as unknown as HostStream;
  await serveShow(stream, {
    showOrder: async (body) => {
      payload = body;
      return 'shown';
    },
  });
  assert.equal(JSON.parse(payload).orderNumber, '1842');
});
