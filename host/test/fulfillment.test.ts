import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyChange,
  confirmCard,
  findOrder,
  isAffirmative,
  parseDay,
  planDeliveryChange,
  planReturn,
  returnCode,
  trackPackage,
} from '../../agent/src/fulfillment.ts';
import { lookupOrder, present } from '../../agent/src/orders.ts';

// A Thursday, so weekday math is easy to read.
const today = new Date(2026, 10, 26);

test('spoken days become offsets from today', () => {
  assert.equal(parseDay('tomorrow', today), 1);
  assert.equal(parseDay('the day after tomorrow', today), 2);
  assert.equal(parseDay('Monday', today), 4);
  assert.equal(parseDay('next Monday', today), 11);
  assert.equal(parseDay('Thursday', today), 7);
  assert.equal(parseDay('in three days', today), 3);
  assert.equal(parseDay('December 2nd', today), 6);
  assert.equal(parseDay('the thirtieth', today), 4);
  assert.equal(parseDay('whenever', today), null);
});

test('a shipped order can be held to a later day, not an earlier one', () => {
  const order = findOrder('222')!; // due in 1 day
  const later = planDeliveryChange(order, { day: 'Monday' }, today);
  assert.ok(later.ok);
  assert.equal(later.ok && later.pending.type === 'delivery' && later.pending.deliveryInDays, 4);

  const sooner = planDeliveryChange(order, { day: 'today' }, today);
  assert.equal(sooner.ok, false);
  const sunday = planDeliveryChange(order, { day: 'Sunday' }, today);
  assert.equal(sunday.ok, false);
  const tooLate = planDeliveryChange(order, { day: 'in 20 days' }, today);
  assert.equal(tooLate.ok, false);
});

test('delivered orders take returns, not delivery changes', () => {
  const delivered = findOrder('333')!;
  assert.equal(planDeliveryChange(delivered, { day: 'Monday' }, today).ok, false);
  const plan = planReturn(delivered, 'wrong size');
  assert.ok(plan.ok);
  assert.equal(planReturn(findOrder('222')!, 'changed my mind').ok, false);
  assert.equal(planReturn(delivered, 'again', { returnCode: 'R33361' }).ok, false);
});

test('a confirmed change shows on every later lookup', () => {
  const plan = planDeliveryChange(findOrder('222')!, { day: 'Monday', instructions: 'at the side door.' }, today);
  assert.ok(plan.ok);
  const changes = applyChange(plan.ok ? plan.pending : (null as never));
  assert.deepEqual(changes, { deliveryInDays: 4, instructions: 'at the side door' });
  const found = lookupOrder({ spoken: '222' }, today, { '222': changes });
  assert.equal(found.outcome, 'found');
  if (found.outcome === 'found') {
    assert.equal(found.card.deliveryLabel, 'Arrives Monday, November 30');
    assert.equal(found.card.instructions, 'at the side door');
    assert.match(found.say, /side door/);
  }
});

test('returns get a code that is easy to say', () => {
  const plan = planReturn(findOrder('333')!, 'wrong size');
  assert.ok(plan.ok);
  const changes = applyChange(plan.ok ? plan.pending : (null as never));
  assert.equal(changes.returnCode, returnCode('333'));
  assert.match(changes.returnCode!, /^R333\d\d$/);
  assert.equal(present(findOrder('333')!, today, changes).card.returnCode, changes.returnCode);
});

test('only a clear yes approves a change', () => {
  for (const yes of ['Yes', 'yeah, do it', 'Sure, sounds good.', 'That’s right', 'okay']) assert.ok(isAffirmative(yes), yes);
  for (const no of ['No', 'no, Tuesday instead', 'wait', 'actually not that', 'hmm', '[no response]', 'yes, no, hold on']) {
    assert.equal(isAffirmative(no), false, no);
  }
});

test('tracking cards place the package along its route', () => {
  const { card, result } = trackPackage(findOrder('555')!, today);
  assert.equal(card.kind, 'tracking');
  assert.equal(card.stops[0].name, 'Louisville, KY');
  assert.equal(card.stops.at(-1)!.name, 'Denver, CO');
  assert.ok(card.progress > 1 && card.progress < card.stops.length - 1);
  assert.match(card.scans[0].label, /In transit/);
  assert.match(result, /Next stop: Kansas City/);
  assert.match(trackPackage(findOrder('111')!, today).result, /has not shipped yet/);
  assert.match(trackPackage(findOrder('333')!, today).result, /delivered yesterday/);
});

test('confirm cards spell out the change', () => {
  const plan = planDeliveryChange(findOrder('555')!, { day: 'Monday' }, today);
  assert.ok(plan.ok);
  const card = confirmCard(findOrder('555')!, plan.ok ? plan.pending : (null as never), today);
  assert.deepEqual(card.lines, ['Deliver Monday, November 30']);
});

test('open orders never arrive on a Sunday', () => {
  const friday = new Date(2026, 10, 27);
  const found = lookupOrder({ spoken: '555' }, friday); // due in 2 days: a Sunday
  assert.equal(found.outcome === 'found' && found.card.deliveryLabel, 'Arrives Monday, November 30');
});

test('a change with only instructions stores no empty fields', () => {
  // Builder refuses undefined inside a thread value; this broke "leave it by the garage".
  const hasUndefined = (value: object) => Object.values(value).some((v) => v === undefined);
  const plan = planDeliveryChange(findOrder('111')!, { day: '', instructions: 'by the garage' }, today);
  assert.ok(plan.ok);
  const pending = plan.ok ? plan.pending : (null as never);
  assert.equal(hasUndefined(pending), false);
  assert.equal('deliveryInDays' in pending, false);
  assert.equal(hasUndefined(applyChange(pending)), false);

  const dayOnly = planDeliveryChange(findOrder('222')!, { day: 'Monday' }, today);
  assert.ok(dayOnly.ok && !('instructions' in dayOnly.pending));
});
